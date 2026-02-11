import { registerAs } from '@nestjs/config';
import { EnvironmentVariables } from './env.validation';

export default registerAs('redis', () => {
  const env = process.env as unknown as EnvironmentVariables;

  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
  };
});
