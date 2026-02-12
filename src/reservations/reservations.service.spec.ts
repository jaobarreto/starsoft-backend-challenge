/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { ReservationsService } from './reservations.service';
import { Reservation, Seat, Session, Sale, SeatStatus, ReservationStatus } from '../entities';
import { CreateReservationDto, ConfirmPaymentDto } from '../dto/reservation.dto';

interface MockQueryBuilder {
  setLock: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  getOne: jest.Mock;
  innerJoinAndSelect?: jest.Mock;
  getMany?: jest.Mock;
}

interface MockQueryRunner {
  connect: jest.Mock;
  startTransaction: jest.Mock;
  commitTransaction: jest.Mock;
  rollbackTransaction: jest.Mock;
  release: jest.Mock;
  manager: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
}

describe('ReservationsService', () => {
  let service: ReservationsService;
  let reservationRepository: jest.Mocked<Repository<Reservation>>;
  let saleRepository: jest.Mocked<Repository<Sale>>;
  let rabbitClient: jest.Mocked<ClientProxy>;
  let queryRunner: MockQueryRunner;

  beforeEach(async () => {
    // Mock QueryRunner
    queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        findOne: jest.fn(),
        save: jest.fn(),
        create: jest.fn(),
        createQueryBuilder: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReservationsService,
        {
          provide: getRepositoryToken(Reservation),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Seat),
          useValue: {
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Session),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Sale),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn().mockReturnValue(queryRunner),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(30), // Default reservation TTL
          },
        },
        {
          provide: 'RABBITMQ_SERVICE',
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ReservationsService>(ReservationsService);
    reservationRepository = module.get(getRepositoryToken(Reservation));
    saleRepository = module.get(getRepositoryToken(Sale));
    rabbitClient = module.get('RABBITMQ_SERVICE');

    // Suppress logger output in tests
    jest.spyOn(service['logger'], 'log').mockImplementation();
    jest.spyOn(service['logger'], 'warn').mockImplementation();
    jest.spyOn(service['logger'], 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createReservation', () => {
    it('should create reservation successfully with pessimistic locking', async () => {
      const createDto: CreateReservationDto = {
        sessionId: 'session-123',
        seatNumbers: ['A1', 'A2'],
        userId: 'user-123',
      };

      const mockSession = {
        id: 'session-123',
        movieName: 'Avatar 3',
        ticketPrice: 25.0,
      } as Session;

      const mockSeat1 = {
        id: 'seat-1',
        seatNumber: 'A1',
        status: SeatStatus.AVAILABLE,
        sessionId: 'session-123',
      } as Seat;

      const mockSeat2 = {
        id: 'seat-2',
        seatNumber: 'A2',
        status: SeatStatus.AVAILABLE,
        sessionId: 'session-123',
      } as Seat;

      const mockReservation1 = {
        id: 'res-1',
        seatId: 'seat-1',
        userId: 'user-123',
        status: ReservationStatus.PENDING,
        expiresAt: new Date(),
        createdAt: new Date(),
      } as Reservation;

      const mockReservation2 = {
        id: 'res-2',
        seatId: 'seat-2',
        userId: 'user-123',
        status: ReservationStatus.PENDING,
        expiresAt: new Date(),
        createdAt: new Date(),
      } as Reservation;

      // Mock query builder for pessimistic locking
      const queryBuilder: MockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn(),
      };

      queryRunner.manager.findOne.mockResolvedValue(mockSession);
      queryRunner.manager.createQueryBuilder.mockReturnValue(queryBuilder);
      queryBuilder.getOne.mockResolvedValueOnce(mockSeat1).mockResolvedValueOnce(mockSeat2);
      queryRunner.manager.create.mockReturnValueOnce(mockReservation1).mockReturnValueOnce(mockReservation2);
      queryRunner.manager.save
        .mockResolvedValueOnce(mockSeat1)
        .mockResolvedValueOnce(mockReservation1)
        .mockResolvedValueOnce(mockSeat2)
        .mockResolvedValueOnce(mockReservation2);

      const result = await service.createReservation(createDto);

      expect(queryRunner.connect).toHaveBeenCalled();
      expect(queryRunner.startTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
      expect(queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(result).toHaveLength(2);
      expect(result[0].seatNumber).toBe('A1');
      expect(result[1].seatNumber).toBe('A2');
      expect(rabbitClient.emit).toHaveBeenCalledWith('reservation.created', expect.any(Object));
    });

    it('should sort seat numbers to prevent deadlock', async () => {
      const createDto: CreateReservationDto = {
        sessionId: 'session-123',
        seatNumbers: ['B2', 'A1', 'B1'], // Unsorted
        userId: 'user-123',
      };

      const mockSession = { id: 'session-123' } as Session;
      const queryBuilder: MockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn(),
      };

      queryRunner.manager.findOne.mockResolvedValue(mockSession);
      queryRunner.manager.createQueryBuilder.mockReturnValue(queryBuilder);

      const seatCalls: string[] = [];
      queryBuilder.andWhere.mockImplementation((condition: string, params: { seatNumber?: string }) => {
        if (params.seatNumber) {
          seatCalls.push(params.seatNumber);
        }
        return queryBuilder;
      });

      // Return different seat objects for each call
      queryBuilder.getOne
        .mockResolvedValueOnce({
          id: 'seat-a1',
          seatNumber: 'A1',
          status: SeatStatus.AVAILABLE,
        })
        .mockResolvedValueOnce({
          id: 'seat-b1',
          seatNumber: 'B1',
          status: SeatStatus.AVAILABLE,
        })
        .mockResolvedValueOnce({
          id: 'seat-b2',
          seatNumber: 'B2',
          status: SeatStatus.AVAILABLE,
        });

      queryRunner.manager.create.mockReturnValue({ id: 'res-id' } as Reservation);
      queryRunner.manager.save.mockResolvedValue({} as Seat);

      await service.createReservation(createDto);

      // Verify seats were locked in sorted order
      expect(seatCalls).toEqual(['A1', 'B1', 'B2']);
    });

    it('should throw NotFoundException when session does not exist', async () => {
      const createDto: CreateReservationDto = {
        sessionId: 'non-existent',
        seatNumbers: ['A1'],
        userId: 'user-123',
      };

      queryRunner.manager.findOne.mockResolvedValue(null);

      await expect(service.createReservation(createDto)).rejects.toThrow(NotFoundException);
      await expect(service.createReservation(createDto)).rejects.toThrow('Session non-existent not found');
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException when seat is not available', async () => {
      const createDto: CreateReservationDto = {
        sessionId: 'session-123',
        seatNumbers: ['A1'],
        userId: 'user-123',
      };

      const mockSession = { id: 'session-123' } as Session;
      const mockSeat = {
        id: 'seat-1',
        seatNumber: 'A1',
        status: SeatStatus.RESERVED, // Already reserved
      } as Seat;

      const queryBuilder: MockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockSeat),
      };

      queryRunner.manager.findOne.mockResolvedValue(mockSession);
      queryRunner.manager.createQueryBuilder.mockReturnValue(queryBuilder);

      await expect(service.createReservation(createDto)).rejects.toThrow(BadRequestException);
      await expect(service.createReservation(createDto)).rejects.toThrow('Seat A1 is not available');
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should throw NotFoundException when seat does not exist', async () => {
      const createDto: CreateReservationDto = {
        sessionId: 'session-123',
        seatNumbers: ['Z99'],
        userId: 'user-123',
      };

      const mockSession = { id: 'session-123' } as Session;
      const queryBuilder: MockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };

      queryRunner.manager.findOne.mockResolvedValue(mockSession);
      queryRunner.manager.createQueryBuilder.mockReturnValue(queryBuilder);

      await expect(service.createReservation(createDto)).rejects.toThrow(NotFoundException);
      await expect(service.createReservation(createDto)).rejects.toThrow('Seat Z99 not found');
    });
  });

  describe('confirmPayment', () => {
    it('should confirm payment and create sale successfully', async () => {
      const confirmDto: ConfirmPaymentDto = {
        reservationId: 'res-123',
        userId: 'user-123',
      };

      const mockReservation = {
        id: 'res-123',
        seatId: 'seat-1',
        userId: 'user-123',
        status: ReservationStatus.PENDING,
        expiresAt: new Date(Date.now() + 10000), // Not expired
        seat: {
          id: 'seat-1',
          seatNumber: 'A1',
          status: SeatStatus.RESERVED,
          sessionId: 'session-123',
          session: {
            id: 'session-123',
            movieName: 'Avatar 3',
            ticketPrice: 25.0,
            startTime: new Date(),
            roomNumber: 'Sala 1',
          },
        },
      } as Reservation;

      const mockSale = {
        id: 'sale-123',
        seatId: 'seat-1',
        userId: 'user-123',
        reservationId: 'res-123',
        amount: 25.0,
        paidAt: new Date(),
        createdAt: new Date(),
        seat: mockReservation.seat,
      } as Sale;

      const queryBuilder: MockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockReservation),
        getMany: jest.fn().mockResolvedValue([mockReservation]),
      };

      queryRunner.manager.createQueryBuilder.mockReturnValue(queryBuilder);
      queryRunner.manager.create.mockReturnValue(mockSale);
      queryRunner.manager.save.mockResolvedValue(mockSale);
      saleRepository.findOne.mockResolvedValue(mockSale);

      const result = await service.confirmPayment(confirmDto);

      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(result).toMatchObject({
        id: 'sale-123',
        seatNumber: 'A1',
        amount: 25.0,
        movieName: 'Avatar 3',
      });
      expect(rabbitClient.emit).toHaveBeenCalledWith('payment.confirmed', expect.any(Object));
    });

    it('should be idempotent - return existing sale if already confirmed', async () => {
      const confirmDto: ConfirmPaymentDto = {
        reservationId: 'res-123',
        userId: 'user-123',
      };

      const mockReservation = {
        id: 'res-123',
        status: ReservationStatus.CONFIRMED, // Already confirmed
        seat: {
          session: {
            movieName: 'Avatar 3',
            ticketPrice: 25.0,
            startTime: new Date(),
            roomNumber: 'Sala 1',
          },
        },
      } as Reservation;

      const mockSale = {
        id: 'sale-123',
        reservationId: 'res-123',
        amount: 25.0,
        seat: {
          seatNumber: 'A1',
          session: mockReservation.seat.session,
        },
      } as Sale;

      const queryBuilder: MockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockReservation),
      };

      queryRunner.manager.createQueryBuilder.mockReturnValue(queryBuilder);
      queryRunner.manager.findOne.mockResolvedValue(mockSale);

      const result = await service.confirmPayment(confirmDto);

      expect(result.id).toBe('sale-123');
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      // Should not create new sale
      expect(queryRunner.manager.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when reservation does not exist', async () => {
      const confirmDto: ConfirmPaymentDto = {
        reservationId: 'non-existent',
        userId: 'user-123',
      };

      const queryBuilder: MockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };

      queryRunner.manager.createQueryBuilder.mockReturnValue(queryBuilder);

      await expect(service.confirmPayment(confirmDto)).rejects.toThrow(NotFoundException);
      await expect(service.confirmPayment(confirmDto)).rejects.toThrow('Reservation non-existent not found');
    });

    it('should throw BadRequestException when reservation is expired', async () => {
      const confirmDto: ConfirmPaymentDto = {
        reservationId: 'res-123',
        userId: 'user-123',
      };

      const mockReservation = {
        id: 'res-123',
        status: ReservationStatus.PENDING,
        expiresAt: new Date(Date.now() - 1000), // Expired
      } as Reservation;

      const queryBuilder: MockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockReservation),
      };

      queryRunner.manager.createQueryBuilder.mockReturnValue(queryBuilder);

      await expect(service.confirmPayment(confirmDto)).rejects.toThrow(BadRequestException);
      await expect(service.confirmPayment(confirmDto)).rejects.toThrow('Reservation has expired');
    });

    it('should throw BadRequestException when reservation is not pending', async () => {
      const confirmDto: ConfirmPaymentDto = {
        reservationId: 'res-123',
        userId: 'user-123',
      };

      const mockReservation = {
        id: 'res-123',
        status: ReservationStatus.EXPIRED,
        expiresAt: new Date(Date.now() + 10000),
      } as Reservation;

      const queryBuilder: MockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockReservation),
      };

      queryRunner.manager.createQueryBuilder.mockReturnValue(queryBuilder);

      await expect(service.confirmPayment(confirmDto)).rejects.toThrow(BadRequestException);
      await expect(service.confirmPayment(confirmDto)).rejects.toThrow('Reservation is not pending');
    });
  });

  describe('expireReservation', () => {
    it('should expire reservation and release seat', async () => {
      const mockReservation = {
        id: 'res-123',
        status: ReservationStatus.PENDING,
        expiresAt: new Date(Date.now() - 1000), // Expired
        userId: 'user-123',
        seat: {
          id: 'seat-1',
          seatNumber: 'A1',
          status: SeatStatus.RESERVED,
          sessionId: 'session-123',
        },
      } as Reservation;

      const queryBuilder: MockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockReservation),
      };

      queryRunner.manager.createQueryBuilder.mockReturnValue(queryBuilder);
      queryRunner.manager.save.mockResolvedValue({});

      await service.expireReservation('res-123');

      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockReservation.status).toBe(ReservationStatus.EXPIRED);
      expect(mockReservation.seat.status).toBe(SeatStatus.AVAILABLE);
      expect(rabbitClient.emit).toHaveBeenCalledWith('reservation.expired', expect.any(Object));
      expect(rabbitClient.emit).toHaveBeenCalledWith('seat.released', expect.any(Object));
    });

    it('should be idempotent - skip if reservation not found', async () => {
      const queryBuilder: MockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };

      queryRunner.manager.createQueryBuilder.mockReturnValue(queryBuilder);

      await service.expireReservation('non-existent');

      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.manager.save).not.toHaveBeenCalled();
    });

    it('should be idempotent - skip if reservation already expired', async () => {
      const mockReservation = {
        id: 'res-123',
        status: ReservationStatus.EXPIRED, // Already expired
      } as Reservation;

      const queryBuilder: MockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockReservation),
      };

      queryRunner.manager.createQueryBuilder.mockReturnValue(queryBuilder);

      await service.expireReservation('res-123');

      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.manager.save).not.toHaveBeenCalled();
    });

    it('should skip expiration if TTL not yet reached', async () => {
      const mockReservation = {
        id: 'res-123',
        status: ReservationStatus.PENDING,
        expiresAt: new Date(Date.now() + 10000), // Not yet expired
      } as Reservation;

      const queryBuilder: MockQueryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        innerJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(mockReservation),
      };

      queryRunner.manager.createQueryBuilder.mockReturnValue(queryBuilder);

      await service.expireReservation('res-123');

      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.manager.save).not.toHaveBeenCalled();
    });
  });

  describe('getUserReservations', () => {
    it('should return all reservations for a user', async () => {
      const mockReservations = [
        {
          id: 'res-1',
          seatId: 'seat-1',
          userId: 'user-123',
          status: ReservationStatus.PENDING,
          expiresAt: new Date(),
          createdAt: new Date(),
          seat: { seatNumber: 'A1' },
        },
        {
          id: 'res-2',
          seatId: 'seat-2',
          userId: 'user-123',
          status: ReservationStatus.CONFIRMED,
          expiresAt: new Date(),
          createdAt: new Date(),
          seat: { seatNumber: 'A2' },
        },
      ] as Reservation[];

      reservationRepository.find.mockResolvedValue(mockReservations);

      const result = await service.getUserReservations('user-123');

      expect(reservationRepository.find).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        relations: ['seat'],
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'res-1',
        seatNumber: 'A1',
        status: ReservationStatus.PENDING,
      });
    });

    it('should return empty array for user with no reservations', async () => {
      reservationRepository.find.mockResolvedValue([]);

      const result = await service.getUserReservations('user-no-reservations');

      expect(result).toEqual([]);
    });
  });
});
