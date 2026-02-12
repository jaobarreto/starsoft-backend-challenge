import { Logger } from '@nestjs/common';
import { Channel, Message } from 'amqplib';

export interface BatchMessage<T = any> {
  data: T;
  message: Message;
}

export interface BatchProcessorOptions {
  batchSize: number;
  flushIntervalMs: number;
  maxWaitMs?: number;
}

/**
 * Generic batch processor for RabbitMQ messages.
 * Accumulates messages and processes them in batches for better performance.
 */
export class BatchProcessor<T = any> {
  private readonly logger = new Logger(BatchProcessor.name);
  private batch: BatchMessage<T>[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private processing = false;
  private batchNumber = 0;

  constructor(
    private readonly channel: Channel,
    private readonly processFn: (items: BatchMessage<T>[]) => Promise<void>,
    private readonly options: BatchProcessorOptions,
  ) {
    this.startFlushTimer();
  }

  /**
   * Add a message to the batch. Will trigger processing if batch size is reached.
   */
  async addMessage(data: T, message: Message): Promise<void> {
    this.batch.push({ data, message });

    this.logger.debug(`Message added to batch. Current size: ${this.batch.length}/${this.options.batchSize}`);

    if (this.batch.length >= this.options.batchSize) {
      await this.flush('batch size reached');
    }
  }

  /**
   * Process all messages in the current batch.
   */
  async flush(reason: string): Promise<void> {
    if (this.processing || this.batch.length === 0) {
      return;
    }

    this.processing = true;
    const currentBatch = [...this.batch];
    this.batch = [];
    this.batchNumber++;

    const batchId = this.batchNumber;

    try {
      this.logger.log(`Processing batch #${batchId} with ${currentBatch.length} messages (reason: ${reason})`);

      const startTime = Date.now();
      await this.processFn(currentBatch);
      const duration = Date.now() - startTime;

      // Ack all messages in the batch
      for (const item of currentBatch) {
        this.channel.ack(item.message);
      }

      this.logger.log(`Batch #${batchId} processed successfully in ${duration}ms (${currentBatch.length} messages)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Batch #${batchId} processing failed: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );

      // Nack all messages in the batch for retry
      for (const item of currentBatch) {
        this.channel.nack(item.message, false, true);
      }
    } finally {
      this.processing = false;
    }
  }

  /**
   * Start automatic flush timer.
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      if (this.batch.length > 0) {
        this.flush('flush interval').catch((err) => {
          this.logger.error('Error during scheduled flush', err);
        });
      }
    }, this.options.flushIntervalMs);
  }

  /**
   * Stop the processor and flush remaining messages.
   */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flush('shutdown');
    this.logger.log('BatchProcessor stopped');
  }
}
