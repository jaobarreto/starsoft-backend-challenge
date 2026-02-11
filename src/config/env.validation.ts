import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNumber, IsString, Max, Min, validateSync } from 'class-validator';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  // Database
  @IsString()
  DB_HOST: string = 'localhost';

  @IsNumber()
  @Min(1)
  @Max(65535)
  DB_PORT: number = 5432;

  @IsString()
  DB_USERNAME: string = 'cinema_user';

  @IsString()
  DB_PASSWORD: string = 'cinema_pass';

  @IsString()
  DB_DATABASE: string = 'cinema_db';

  // Redis
  @IsString()
  REDIS_HOST: string = 'localhost';

  @IsNumber()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number = 6379;

  // RabbitMQ
  @IsString()
  RABBITMQ_HOST: string = 'localhost';

  @IsNumber()
  @Min(1)
  @Max(65535)
  RABBITMQ_PORT: number = 5672;

  @IsString()
  RABBITMQ_USER: string = 'cinema_user';

  @IsString()
  RABBITMQ_PASSWORD: string = 'cinema_pass';

  // Application
  @IsNumber()
  @Min(10)
  @Max(3600)
  RESERVATION_TTL_SECONDS: number = 30;

  @IsNumber()
  @Min(1)
  @Max(1000)
  RATE_LIMIT_TTL: number = 60;

  @IsNumber()
  @Min(1)
  @Max(10000)
  RATE_LIMIT_MAX: number = 100;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }

  return validatedConfig;
}
