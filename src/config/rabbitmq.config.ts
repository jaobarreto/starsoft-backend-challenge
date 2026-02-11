import { registerAs } from '@nestjs/config';
import { EnvironmentVariables } from './env.validation';

export default registerAs('rabbitmq', () => {
  const env = process.env as unknown as EnvironmentVariables;

  const url = `amqp://${env.RABBITMQ_USER}:${env.RABBITMQ_PASSWORD}@${env.RABBITMQ_HOST}:${env.RABBITMQ_PORT}`;

  return {
    host: env.RABBITMQ_HOST,
    port: env.RABBITMQ_PORT,
    user: env.RABBITMQ_USER,
    password: env.RABBITMQ_PASSWORD,
    url,
    // DLX + TTL topology names (referenced by service & consumer)
    expiration: {
      exchange: 'reservation.expiration.exchange',
      dlx: 'reservation.expiration.dlx',
      waitQueue: 'reservation.expiration.wait',
      processQueue: 'reservation.expiration.process',
      routingKey: 'reservation.expire',
    },
  };
});
