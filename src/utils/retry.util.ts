import { Logger } from '@nestjs/common';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableErrors?: Array<new (...args: any[]) => Error>;
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}

const defaultOptions: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  backoffMultiplier: 2,
  retryableErrors: [],
  onRetry: () => {},
};

/**
 * Executes a function with exponential backoff retry logic.
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @returns The result of the function execution
 * @throws The last error if all retries are exhausted
 *
 * @example
 * const result = await retryWithBackoff(
 *   () => database.query('SELECT * FROM users'),
 *   { maxAttempts: 5, initialDelayMs: 200 }
 * );
 */
export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const opts = { ...defaultOptions, ...options };
  const logger = new Logger('RetryUtil');

  let lastError: Error;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if error is retryable
      if (opts.retryableErrors.length > 0) {
        const isRetryable = opts.retryableErrors.some((ErrorClass) => lastError instanceof ErrorClass);
        if (!isRetryable) {
          throw lastError;
        }
      }

      // If this was the last attempt, throw
      if (attempt >= opts.maxAttempts) {
        logger.error(
          `Max retry attempts (${opts.maxAttempts}) reached. Last error: ${lastError.message}`,
          lastError.stack,
        );
        throw lastError;
      }

      // Calculate delay with exponential backoff
      const delayMs = Math.min(opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt - 1), opts.maxDelayMs);

      logger.warn(`Attempt ${attempt}/${opts.maxAttempts} failed: ${lastError.message}. Retrying in ${delayMs}ms...`);

      opts.onRetry(lastError, attempt, delayMs);

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError!;
}

/**
 * Decorator for adding retry logic to class methods.
 *
 * @example
 * class MyService {
 *   @Retry({ maxAttempts: 5, initialDelayMs: 100 })
 *   async fetchData() {
 *     return await externalApi.getData();
 *   }
 * }
 */
export function Retry(options: RetryOptions = {}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      return retryWithBackoff(() => originalMethod.apply(this, args), options);
    };

    return descriptor;
  };
}
