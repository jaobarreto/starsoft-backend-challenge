import { Controller, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { Channel, Message } from 'amqplib';
import { ReservationsService } from './reservations.service';
import { BatchProcessor } from '../utils/batch-processor.util';

/**
 * Consumer that listens on multiple queues for reservation-related events.
 *
 * Handles three types of events:
 * 1. reservation.expire - Batch processed for performance
 * 2. reservation.created - Individual processing for logging/notifications
 * 3. payment.confirmed - Individual processing for logging/notifications
 *
 * Uses batch processing for expirations and retry with exponential backoff
 * for resilient error handling.
 *
 * Fully idempotent — relies on ReservationsService methods that check
 * status before acting.
 */
@Controller()
export class ReservationsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReservationsConsumer.name);
  private batchProcessor: BatchProcessor<{ reservationId: string }> | null = null;
  private channel: Channel | null = null;

  constructor(private readonly reservationsService: ReservationsService) {}

  onModuleInit() {
    this.logger.log('ReservationsConsumer initialized - listening for reservation events');
  }

  async onModuleDestroy() {
    if (this.batchProcessor) {
      await this.batchProcessor.stop();
    }
    this.logger.log('ReservationsConsumer shut down gracefully');
  }

  /**
   * Initialize channel from any event that arrives first.
   * This ensures the channel is captured before batch processor is needed.
   */
  private initializeChannel(channel: Channel): void {
    if (!this.channel) {
      this.channel = channel;
      this.logger.log('Channel initialized from incoming message');
    }
  }

  /**
   * Handles reservation.created events from cinema_queue.
   * Logs reservation creation for monitoring and potential future processing.
   *
   * These events are emitted after successful reservation creation.
   */
  @EventPattern('reservation.created')
  handleReservationCreated(
    @Payload()
    data: {
      reservationId: string;
      seatId: string;
      seatNumber: string;
      userId: string;
      expiresAt: Date;
      timestamp: Date;
    },
    @Ctx() context: RmqContext,
  ): void {
    const channel = context.getChannelRef() as Channel;
    const originalMsg = context.getMessage() as Message;

    this.initializeChannel(channel);

    try {
      this.logger.log(
        `Reservation created: ${data.reservationId} for user ${data.userId} - Seat ${data.seatNumber} (expires: ${new Date(data.expiresAt).toISOString()})`,
      );

      // Future: Send notification, update analytics, etc.
      // For now, just log the event

      // Acknowledge message
      channel.ack(originalMsg);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to process reservation.created for ${data.reservationId}: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
      // Nack and requeue for retry
      channel.nack(originalMsg, false, true);
    }
  }

  /**
   * Handles payment.confirmed events from cinema_queue.
   * Logs payment confirmation for monitoring and potential future processing.
   *
   * These events are emitted after successful payment confirmation.
   */
  @EventPattern('payment.confirmed')
  handlePaymentConfirmed(
    @Payload()
    data: {
      saleId: string;
      reservationId: string;
      seatId: string;
      seatNumber: string;
      userId: string;
      amount: string;
      timestamp: Date;
    },
    @Ctx() context: RmqContext,
  ): void {
    const channel = context.getChannelRef() as Channel;
    const originalMsg = context.getMessage() as Message;

    this.initializeChannel(channel);

    try {
      this.logger.log(
        `Payment confirmed: Sale ${data.saleId} for reservation ${data.reservationId} - User ${data.userId} paid ${data.amount} for seat ${data.seatNumber}`,
      );

      // Future: Send confirmation email, update revenue tracking, etc.
      // For now, just log the event

      // Acknowledge message
      channel.ack(originalMsg);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to process payment.confirmed for sale ${data.saleId}: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
      // Nack and requeue for retry
      channel.nack(originalMsg, false, true);
    }
  }

  /**
   * Handles expired reservations from the DLX process queue (reservation.expiration.process.queue).
   * Messages arrive here after TTL expires in the wait queue.
   *
   * Uses batch processing for performance. Messages are batched and processed together,
   * with all-or-nothing acknowledgment for the batch.
   */
  @EventPattern('reservation.expire')
  async handleReservationExpire(@Payload() data: { reservationId: string }, @Ctx() context: RmqContext): Promise<void> {
    const channel = context.getChannelRef() as Channel;
    const originalMsg = context.getMessage() as Message;

    this.initializeChannel(channel);

    // Lazy initialize batch processor on first message
    if (!this.batchProcessor) {
      this.batchProcessor = new BatchProcessor<{ reservationId: string }>(
        this.channel!,
        async (items) => {
          this.logger.log(`Processing batch of ${items.length} reservation expirations`);

          const results = await Promise.allSettled(
            items.map((item) => this.reservationsService.expireReservation(item.data.reservationId)),
          );

          const succeeded = results.filter((r) => r.status === 'fulfilled').length;
          const failed = results.filter((r) => r.status === 'rejected').length;

          if (failed > 0) {
            this.logger.warn(`Batch completed with ${succeeded} successes and ${failed} failures`);
            // Log each failure
            results.forEach((result, index) => {
              if (result.status === 'rejected') {
                const reservationId = items[index].data.reservationId;
                const errorMessage = result.reason instanceof Error ? result.reason.message : 'Unknown error';
                this.logger.error(
                  `Failed to expire reservation ${reservationId}: ${errorMessage}`,
                  result.reason instanceof Error ? result.reason.stack : undefined,
                );
              }
            });
            throw new Error(`Batch processing had ${failed} failures`);
          }

          this.logger.log(`Batch completed successfully: ${succeeded} reservations expired`);
        },
        {
          batchSize: 10,
          flushIntervalMs: 2000,
        },
      );
      this.logger.log('Batch processor initialized for reservation.expire events');
    }

    // Add message to batch
    await this.batchProcessor.addMessage(data, originalMsg);
  }
}
