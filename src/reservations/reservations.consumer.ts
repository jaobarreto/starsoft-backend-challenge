import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { Channel, Message } from 'amqplib';
import { ReservationsService } from './reservations.service';

/**
 * Consumer that listens on the DLX process queue for expired reservations.
 * After the per-message TTL expires in the wait queue, messages are
 * dead-lettered to the process queue and consumed here.
 *
 * Uses NestJS native microservices pattern for clean, type-safe message handling.
 * Fully idempotent — relies on ReservationsService.expireReservation()
 * which checks reservation status before acting.
 */
@Controller()
export class ReservationsConsumer {
  private readonly logger = new Logger(ReservationsConsumer.name);

  constructor(private readonly reservationsService: ReservationsService) {}

  /**
   * Handles reservation expiration events from the DLX process queue.
   * Messages arrive here after TTL expiration via dead-letter exchange.
   */
  @EventPattern('reservation.expire')
  async handleReservationExpire(@Payload() data: { reservationId: string }, @Ctx() context: RmqContext): Promise<void> {
    const channel = context.getChannelRef() as Channel;
    const originalMsg = context.getMessage() as Message;

    try {
      this.logger.log(`Processing expiration for reservation ${data.reservationId}`);
      await this.reservationsService.expireReservation(data.reservationId);
      channel.ack(originalMsg);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to process expiration for ${data.reservationId}: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
      // Nack + requeue so it can be retried
      channel.nack(originalMsg, false, true);
    }
  }
}
