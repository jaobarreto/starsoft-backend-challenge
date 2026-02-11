import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';
import { ReservationsConsumer } from './reservations.consumer';
import { Reservation, Seat, Session, Sale } from '../entities';

@Module({
  imports: [
    TypeOrmModule.forFeature([Reservation, Seat, Session, Sale]),
    // Producer client for emitting events
    ClientsModule.registerAsync([
      {
        name: 'RABBITMQ_SERVICE',
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [configService.get('rabbitmq.url')],
            queue: 'cinema_queue',
            queueOptions: {
              durable: true,
            },
          },
        }),
        inject: [ConfigService],
      },
    ]),
    // Consumer client for expiration events (DLX process queue)
    ClientsModule.registerAsync([
      {
        name: 'EXPIRATION_CONSUMER',
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [configService.get('rabbitmq.url')],
            queue: 'reservation.expiration.process',
            noAck: false,
            prefetchCount: 1,
            queueOptions: {
              durable: true,
            },
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  controllers: [ReservationsController, ReservationsConsumer],
  providers: [ReservationsService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
