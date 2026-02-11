import { Injectable, Logger, NotFoundException, BadRequestException, Inject, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { Reservation, Seat, Session, Sale, SeatStatus, ReservationStatus } from '../entities';
import { CreateReservationDto, ReservationResponseDto, ConfirmPaymentDto } from '../dto/reservation.dto';
import { SaleResponseDto } from '../dto/sale.dto';
import { connect, type Channel, type ChannelModel } from 'amqplib';

// DLX + TTL queue constants
const EXPIRATION_EXCHANGE = 'reservation.expiration.exchange';
const EXPIRATION_DLX = 'reservation.expiration.dlx';
const EXPIRATION_WAIT_QUEUE = 'reservation.expiration.wait';
const EXPIRATION_PROCESS_QUEUE = 'reservation.expiration.process';
const EXPIRATION_ROUTING_KEY = 'reservation.expire';

@Injectable()
export class ReservationsService implements OnModuleInit {
  private readonly logger = new Logger(ReservationsService.name);
  private readonly reservationTtl: number;
  private amqpConnection: ChannelModel | null = null;
  private amqpChannel: Channel | null = null;

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

  /**
   * On module init: set up DLX + TTL topology in RabbitMQ for delayed expiration.
   *
   * Flow:
   *   Producer → EXPIRATION_EXCHANGE → EXPIRATION_WAIT_QUEUE (TTL per-message, DLX → EXPIRATION_DLX)
   *                                                        ↓ (after TTL expires)
   *                                    EXPIRATION_DLX → EXPIRATION_PROCESS_QUEUE → Consumer
   */
  async onModuleInit() {
    try {
      const rabbitmqUrl = this.configService.get<string>('rabbitmq.url');
      this.amqpConnection = await connect(rabbitmqUrl!);
      this.amqpChannel = await this.amqpConnection.createChannel();

      const channel = this.amqpChannel;

      // 1. Declare the DLX (dead-letter exchange) — messages arrive here after TTL
      await channel.assertExchange(EXPIRATION_DLX, 'direct', { durable: true });

      // 2. Declare the main exchange for publishing delayed messages
      await channel.assertExchange(EXPIRATION_EXCHANGE, 'direct', { durable: true });

      // 3. Wait queue: messages sit here with per-message TTL, then dead-letter to DLX
      await channel.assertQueue(EXPIRATION_WAIT_QUEUE, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': EXPIRATION_DLX,
          'x-dead-letter-routing-key': EXPIRATION_ROUTING_KEY,
        },
      });
      await channel.bindQueue(EXPIRATION_WAIT_QUEUE, EXPIRATION_EXCHANGE, EXPIRATION_ROUTING_KEY);

      // 4. Process queue: consumer reads from here after TTL expires
      await channel.assertQueue(EXPIRATION_PROCESS_QUEUE, { durable: true });
      await channel.bindQueue(EXPIRATION_PROCESS_QUEUE, EXPIRATION_DLX, EXPIRATION_ROUTING_KEY);

      this.logger.log('RabbitMQ DLX + TTL topology initialized for reservation expiration');
    } catch (error) {
      this.logger.error('Failed to initialize RabbitMQ DLX topology', error instanceof Error ? error.stack : error);
    }
  }

  /**
   * Publish a delayed expiration message using per-message TTL + DLX.
   */
  private publishDelayedExpiration(reservationId: string, delayMs: number): void {
    if (!this.amqpChannel) {
      this.logger.warn('AMQP channel not available, cannot schedule expiration');
      return;
    }

    const payload = JSON.stringify({ reservationId });
    this.amqpChannel.publish(EXPIRATION_EXCHANGE, EXPIRATION_ROUTING_KEY, Buffer.from(payload), {
      persistent: true,
      expiration: String(delayMs), // per-message TTL in ms
    });

    this.logger.log(`Scheduled expiration for reservation ${reservationId} in ${delayMs}ms`);
  }

  async createReservation(createReservationDto: CreateReservationDto): Promise<ReservationResponseDto[]> {
    // Sort seat numbers to prevent deadlock (consistent lock ordering)
    const sortedSeatNumbers = [...createReservationDto.seatNumbers].sort();

    this.logger.log(
      `Creating reservation for user ${createReservationDto.userId} - Seats: ${sortedSeatNumbers.join(', ')}`,
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

      for (const seatNumber of sortedSeatNumbers) {
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
      }

      await queryRunner.commitTransaction();

      // After commit: publish events and schedule expiration via DLX
      for (const res of reservations) {
        this.rabbitClient.emit('reservation.created', {
          reservationId: res.id,
          seatId: res.seatId,
          seatNumber: res.seatNumber,
          userId: res.userId,
          expiresAt: res.expiresAt,
          timestamp: new Date(),
        });

        // Schedule delayed expiration via DLX + TTL
        this.publishDelayedExpiration(res.id, this.reservationTtl * 1000);
      }

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
      // Pessimistic lock on reservation + joined seat + session
      const reservation = await queryRunner.manager
        .createQueryBuilder(Reservation, 'reservation')
        .setLock('pessimistic_write')
        .innerJoinAndSelect('reservation.seat', 'seat')
        .innerJoinAndSelect('seat.session', 'session')
        .where('reservation.id = :id', { id: confirmPaymentDto.reservationId })
        .andWhere('reservation.userId = :userId', { userId: confirmPaymentDto.userId })
        .getOne();

      if (!reservation) {
        throw new NotFoundException(`Reservation ${confirmPaymentDto.reservationId} not found`);
      }

      // Idempotency: if already confirmed, return existing sale
      if (reservation.status === ReservationStatus.CONFIRMED) {
        const existingSale = await queryRunner.manager.findOne(Sale, {
          where: { reservationId: reservation.id },
          relations: ['seat', 'seat.session'],
        });

        await queryRunner.commitTransaction();

        if (!existingSale) {
          throw new BadRequestException('Reservation is confirmed but sale record not found');
        }

        this.logger.log(`Idempotent confirmPayment: reservation ${reservation.id} already confirmed`);

        return {
          id: existingSale.id,
          seatId: existingSale.seatId,
          seatNumber: existingSale.seat.seatNumber,
          userId: existingSale.userId,
          reservationId: existingSale.reservationId,
          amount: Number(existingSale.amount),
          movieName: existingSale.seat.session.movieName,
          sessionStartTime: existingSale.seat.session.startTime,
          roomNumber: existingSale.seat.session.roomNumber,
          paidAt: existingSale.paidAt,
          createdAt: existingSale.createdAt,
        };
      }

      if (reservation.status !== ReservationStatus.PENDING) {
        throw new BadRequestException(`Reservation is not pending (status: ${reservation.status})`);
      }

      if (new Date() > reservation.expiresAt) {
        throw new BadRequestException('Reservation has expired');
      }

      // Find all reservations from the same booking group (same user, session, and expiresAt)
      // When a user reserves multiple seats together, they all have the same expiresAt timestamp
      const relatedReservations = await queryRunner.manager
        .createQueryBuilder(Reservation, 'reservation')
        .setLock('pessimistic_write')
        .innerJoinAndSelect('reservation.seat', 'seat')
        .innerJoinAndSelect('seat.session', 'session')
        .where('reservation.userId = :userId', { userId: reservation.userId })
        .andWhere('seat.sessionId = :sessionId', { sessionId: reservation.seat.sessionId })
        .andWhere('reservation.expiresAt = :expiresAt', { expiresAt: reservation.expiresAt })
        .andWhere('reservation.status = :status', { status: ReservationStatus.PENDING })
        .getMany();

      this.logger.log(
        `Confirming ${relatedReservations.length} reservations from the same booking group: ${relatedReservations.map((r) => r.id).join(', ')}`,
      );

      const sales: Sale[] = [];
      const paidAt = new Date();

      // Confirm all related reservations and create sales
      for (const res of relatedReservations) {
        // Update reservation status
        res.status = ReservationStatus.CONFIRMED;
        await queryRunner.manager.save(Reservation, res);

        // Update seat status
        res.seat.status = SeatStatus.SOLD;
        await queryRunner.manager.save(Seat, res.seat);

        // Create sale record
        const sale = queryRunner.manager.create(Sale, {
          seatId: res.seat.id,
          userId: res.userId,
          reservationId: res.id,
          amount: res.seat.session.ticketPrice,
          paidAt,
        });

        const savedSale = await queryRunner.manager.save(Sale, sale);
        sales.push(savedSale);
      }

      await queryRunner.commitTransaction();

      // Publish events to RabbitMQ for all confirmed sales
      for (const sale of sales) {
        const saleReservation = relatedReservations.find((r) => r.id === sale.reservationId);
        if (saleReservation) {
          this.rabbitClient.emit('payment.confirmed', {
            saleId: sale.id,
            reservationId: sale.reservationId,
            seatId: sale.seatId,
            seatNumber: saleReservation.seat.seatNumber,
            userId: sale.userId,
            amount: sale.amount,
            timestamp: new Date(),
          });
        }
      }

      this.logger.log(
        `Payment confirmed successfully for ${sales.length} reservations. Sale IDs: ${sales.map((s) => s.id).join(', ')}`,
      );

      // Return the sale for the originally requested reservation
      const primarySale = sales.find((s) => s.reservationId === reservation.id);
      if (!primarySale) {
        throw new Error('Primary sale not found after payment confirmation');
      }

      // Reload with relations for response
      const saleWithRelations = await this.saleRepository.findOne({
        where: { id: primarySale.id },
        relations: ['seat', 'seat.session'],
      });

      if (!saleWithRelations) {
        throw new Error('Sale not found after creation');
      }

      return {
        id: saleWithRelations.id,
        seatId: saleWithRelations.seatId,
        seatNumber: saleWithRelations.seat.seatNumber,
        userId: saleWithRelations.userId,
        reservationId: saleWithRelations.reservationId,
        amount: Number(saleWithRelations.amount),
        movieName: saleWithRelations.seat.session.movieName,
        sessionStartTime: saleWithRelations.seat.session.startTime,
        roomNumber: saleWithRelations.seat.session.roomNumber,
        paidAt: saleWithRelations.paidAt,
        createdAt: saleWithRelations.createdAt,
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

  /**
   * Expire a reservation if it is still PENDING and past its TTL.
   * Called by the consumer after DLX delivers the delayed message.
   * Fully idempotent — safe to call multiple times for the same reservation.
   */
  async expireReservation(reservationId: string): Promise<void> {
    this.logger.log(`Processing expiration for reservation ${reservationId}`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const reservation = await queryRunner.manager
        .createQueryBuilder(Reservation, 'reservation')
        .setLock('pessimistic_write')
        .innerJoinAndSelect('reservation.seat', 'seat')
        .where('reservation.id = :id', { id: reservationId })
        .getOne();

      if (!reservation) {
        this.logger.warn(`Reservation ${reservationId} not found for expiration (already deleted?)`);
        await queryRunner.commitTransaction();
        return;
      }

      // Idempotent: if not PENDING, nothing to expire
      if (reservation.status !== ReservationStatus.PENDING) {
        this.logger.log(`Reservation ${reservationId} is ${reservation.status}, skipping expiration (idempotent)`);
        await queryRunner.commitTransaction();
        return;
      }

      // Only expire if TTL has actually passed
      if (new Date() <= reservation.expiresAt) {
        this.logger.log(`Reservation ${reservationId} TTL not yet reached, skipping`);
        await queryRunner.commitTransaction();
        return;
      }

      // Expire the reservation and release the seat
      reservation.status = ReservationStatus.EXPIRED;
      reservation.seat.status = SeatStatus.AVAILABLE;

      await queryRunner.manager.save(Seat, reservation.seat);
      await queryRunner.manager.save(Reservation, reservation);

      await queryRunner.commitTransaction();

      // Publish domain events after commit
      this.rabbitClient.emit('reservation.expired', {
        reservationId: reservation.id,
        seatId: reservation.seat.id,
        seatNumber: reservation.seat.seatNumber,
        userId: reservation.userId,
        timestamp: new Date(),
      });

      this.rabbitClient.emit('seat.released', {
        seatId: reservation.seat.id,
        seatNumber: reservation.seat.seatNumber,
        sessionId: reservation.seat.sessionId,
        timestamp: new Date(),
      });

      this.logger.log(`Reservation ${reservationId} expired, seat ${reservation.seat.seatNumber} released`);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to expire reservation ${reservationId}: ${errorMessage}`, errorStack);
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
