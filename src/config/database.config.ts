import { registerAs } from '@nestjs/config';
import { EnvironmentVariables } from './env.validation';

export default registerAs('database', () => {
  const env = process.env as unknown as EnvironmentVariables;

  return {
    type: 'postgres' as const,
    host: env.DB_HOST,
    port: env.DB_PORT,
    username: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    database: env.DB_DATABASE,
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    synchronize: String(env.NODE_ENV) === 'development',
    logging: String(env.NODE_ENV) === 'development',
  };
});
