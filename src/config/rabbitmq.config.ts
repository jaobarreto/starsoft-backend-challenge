import { registerAs } from '@nestjs/config';
import { EnvironmentVariables } from './env.validation';

export default registerAs('rabbitmq', () => {
  const env = process.env as unknown as EnvironmentVariables;

  return {
    host: env.RABBITMQ_HOST,
    port: env.RABBITMQ_PORT,
    user: env.RABBITMQ_USER,
    password: env.RABBITMQ_PASSWORD,
    url: `amqp://${env.RABBITMQ_USER}:${env.RABBITMQ_PASSWORD}@${env.RABBITMQ_HOST}:${env.RABBITMQ_PORT}`,
  };
});
