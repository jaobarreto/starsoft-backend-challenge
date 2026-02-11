import { Injectable, Logger, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { Reservation, Seat, Session, Sale, SeatStatus, ReservationStatus } from '../entities';
import { CreateReservationDto, ReservationResponseDto, ConfirmPaymentDto } from '../dto/reservation.dto';
import { SaleResponseDto } from '../dto/sale.dto';

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);
  private readonly reservationTtl: number;

  constructor(
    @InjectRepository(Reservation)
    private readonly reservationRepository: Repository<Reservation>,
    @InjectRepository(Seat)
    private readonly seatRepository: Repository<Seat>,
    @InjectRepository(Session)
    private readonly sessionRepository: Repository<Session>,
    @InjectRepository(Sale)
    private readonly saleRepository: Repository<Sale>,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    @Inject('RABBITMQ_SERVICE')
    private readonly rabbitClient: ClientProxy,
  ) {
    this.reservationTtl = this.configService.get<number>('app.reservationTtl', 30);
  }

  async createReservation(createReservationDto: CreateReservationDto): Promise<ReservationResponseDto[]> {
    this.logger.log(
      `Creating reservation for user ${createReservationDto.userId} - Seats: ${createReservationDto.seatNumbers.join(', ')}`,
    );

    // Start a transaction with pessimistic locking
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const session = await queryRunner.manager.findOne(Session, {
        where: { id: createReservationDto.sessionId },
      });

      if (!session) {
        throw new NotFoundException(`Session ${createReservationDto.sessionId} not found`);
      }

      const reservations: ReservationResponseDto[] = [];
      const expiresAt = new Date(Date.now() + this.reservationTtl * 1000);

      for (const seatNumber of createReservationDto.seatNumbers) {
        // Lock the seat row with SELECT FOR UPDATE to prevent race conditions
        const seat = await queryRunner.manager
          .createQueryBuilder(Seat, 'seat')
          .setLock('pessimistic_write')
          .where('seat.sessionId = :sessionId', { sessionId: session.id })
          .andWhere('seat.seatNumber = :seatNumber', { seatNumber })
          .getOne();

        if (!seat) {
          throw new NotFoundException(`Seat ${seatNumber} not found in session ${session.id}`);
        }

        if (seat.status !== SeatStatus.AVAILABLE) {
          throw new BadRequestException(`Seat ${seatNumber} is not available (current status: ${seat.status})`);
        }

        // Update seat status
        seat.status = SeatStatus.RESERVED;
        await queryRunner.manager.save(Seat, seat);

        // Create reservation
        const reservation = queryRunner.manager.create(Reservation, {
          seatId: seat.id,
          userId: createReservationDto.userId,
          status: ReservationStatus.PENDING,
          expiresAt,
        });

        const savedReservation = await queryRunner.manager.save(Reservation, reservation);

        reservations.push({
          id: savedReservation.id,
          seatId: seat.id,
          seatNumber: seat.seatNumber,
          userId: savedReservation.userId,
          status: savedReservation.status,
          expiresAt: savedReservation.expiresAt,
          createdAt: savedReservation.createdAt,
        });

        // Publish event to RabbitMQ
        this.rabbitClient.emit('reservation.created', {
          reservationId: savedReservation.id,
          seatId: seat.id,
          seatNumber: seat.seatNumber,
          userId: savedReservation.userId,
          expiresAt: savedReservation.expiresAt,
          timestamp: new Date(),
        });
      }

      await queryRunner.commitTransaction();

      this.logger.log(`Reservations created successfully: ${reservations.map((r) => r.id).join(', ')}`);

      return reservations;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to create reservation: ${errorMessage}`, errorStack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async confirmPayment(confirmPaymentDto: ConfirmPaymentDto): Promise<SaleResponseDto> {
    this.logger.log(`Confirming payment for reservation ${confirmPaymentDto.reservationId}`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const reservation = await queryRunner.manager.findOne(Reservation, {
        where: {
          id: confirmPaymentDto.reservationId,
          userId: confirmPaymentDto.userId,
        },
        relations: ['seat', 'seat.session'],
      });

      if (!reservation) {
        throw new NotFoundException(`Reservation ${confirmPaymentDto.reservationId} not found`);
      }

      if (reservation.status !== ReservationStatus.PENDING) {
        throw new BadRequestException(`Reservation is not pending (status: ${reservation.status})`);
      }

      if (new Date() > reservation.expiresAt) {
        throw new BadRequestException('Reservation has expired');
      }

      // Update reservation status
      reservation.status = ReservationStatus.CONFIRMED;
      await queryRunner.manager.save(Reservation, reservation);

      // Update seat status
      const seat = reservation.seat;
      seat.status = SeatStatus.SOLD;
      await queryRunner.manager.save(Seat, seat);

      // Create sale record
      const sale = queryRunner.manager.create(Sale, {
        seatId: seat.id,
        userId: reservation.userId,
        reservationId: reservation.id,
        amount: reservation.seat.session.ticketPrice,
        paidAt: new Date(),
      });

      const savedSale = await queryRunner.manager.save(Sale, sale);

      await queryRunner.commitTransaction();

      // Publish event to RabbitMQ
      this.rabbitClient.emit('payment.confirmed', {
        saleId: savedSale.id,
        reservationId: reservation.id,
        seatId: seat.id,
        seatNumber: seat.seatNumber,
        userId: reservation.userId,
        amount: savedSale.amount,
        timestamp: new Date(),
      });

      this.logger.log(`Payment confirmed successfully for reservation ${reservation.id}`);

      return {
        id: savedSale.id,
        seatId: seat.id,
        seatNumber: seat.seatNumber,
        userId: savedSale.userId,
        reservationId: savedSale.reservationId,
        amount: Number(savedSale.amount),
        movieName: reservation.seat.session.movieName,
        sessionStartTime: reservation.seat.session.startTime,
        roomNumber: reservation.seat.session.roomNumber,
        paidAt: savedSale.paidAt,
        createdAt: savedSale.createdAt,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to confirm payment: ${errorMessage}`, errorStack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getUserReservations(userId: string): Promise<ReservationResponseDto[]> {
    const reservations = await this.reservationRepository.find({
      where: { userId },
      relations: ['seat'],
      order: { createdAt: 'DESC' },
    });

    return reservations.map((reservation) => ({
      id: reservation.id,
      seatId: reservation.seatId,
      seatNumber: reservation.seat.seatNumber,
      userId: reservation.userId,
      status: reservation.status,
      expiresAt: reservation.expiresAt,
      createdAt: reservation.createdAt,
    }));
  }
}
