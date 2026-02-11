import { registerAs } from '@nestjs/config';
import { EnvironmentVariables } from './env.validation';

export default registerAs('app', () => {
  const env = process.env as unknown as EnvironmentVariables;

  return {
    port: env.PORT,
    nodeEnv: env.NODE_ENV,
    reservationTtl: env.RESERVATION_TTL_SECONDS,
    rateLimitTtl: env.RATE_LIMIT_TTL,
    rateLimitMax: env.RATE_LIMIT_MAX,
  };
});
