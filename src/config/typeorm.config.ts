import { DataSource, DataSourceOptions } from 'typeorm';
import { config as dotenvConfig } from 'dotenv';
import { EnvironmentVariables } from './env.validation';

dotenvConfig();

const env = process.env as unknown as EnvironmentVariables;

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: env.DB_HOST,
  port: env.DB_PORT,
  username: env.DB_USERNAME,
  password: env.DB_PASSWORD,
  database: env.DB_DATABASE,
  entities: ['dist/entities/**/*.entity.js'],
  migrations: ['dist/migrations/**/*.js'],
  synchronize: String(env.NODE_ENV) === 'development',
  logging: String(env.NODE_ENV) === 'development',
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;
