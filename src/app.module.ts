import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import rabbitmqConfig from './config/rabbitmq.config';
import appConfig from './config/app.config';
import { validate } from './config/env.validation';
import { Session, Seat, Reservation, Sale } from './entities';
import { SessionsModule } from './sessions/sessions.module';
import { ReservationsModule } from './reservations/reservations.module';
import { SalesModule } from './sales/sales.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [databaseConfig, redisConfig, rabbitmqConfig, appConfig],
      validate,
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('database.host'),
        port: configService.get('database.port'),
        username: configService.get('database.username'),
        password: configService.get('database.password'),
        database: configService.get('database.database'),
        entities: [Session, Seat, Reservation, Sale],
        synchronize: configService.get('app.nodeEnv') === 'development' || configService.get('app.nodeEnv') === 'test',
        logging: configService.get('app.nodeEnv') === 'development',
        dropSchema: configService.get('app.nodeEnv') === 'test',
      }),
      inject: [ConfigService],
    }),
    SessionsModule,
    ReservationsModule,
    SalesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
