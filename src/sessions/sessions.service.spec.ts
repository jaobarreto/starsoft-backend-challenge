import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { Session, Seat, SeatStatus } from '../entities';
import { CreateSessionDto } from '../dto/session.dto';

/* eslint-disable @typescript-eslint/unbound-method */

describe('SessionsService', () => {
  let service: SessionsService;
  let sessionRepository: jest.Mocked<Repository<Session>>;
  let seatRepository: jest.Mocked<Repository<Seat>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionsService,
        {
          provide: getRepositoryToken(Session),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Seat),
          useValue: {
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SessionsService>(SessionsService);
    sessionRepository = module.get(getRepositoryToken(Session));
    seatRepository = module.get(getRepositoryToken(Seat));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createSession', () => {
    it('should create a session with seats successfully', async () => {
      const createSessionDto: CreateSessionDto = {
        movieName: 'Avatar 3',
        startTime: '2026-02-15T19:00:00Z',
        roomNumber: 'Sala 1',
        ticketPrice: 25.0,
        numberOfSeats: 16,
      };

      const mockSession = {
        id: 'session-id-123',
        movieName: 'Avatar 3',
        startTime: new Date('2026-02-15T19:00:00Z'),
        roomNumber: 'Sala 1',
        ticketPrice: 25.0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Session;

      sessionRepository.create.mockReturnValue(mockSession);
      sessionRepository.save.mockResolvedValue(mockSession);
      seatRepository.save.mockImplementation((entity: any) => Promise.resolve(entity));

      const result = await service.createSession(createSessionDto);

      expect(sessionRepository.create).toHaveBeenCalledWith({
        movieName: 'Avatar 3',
        startTime: new Date('2026-02-15T19:00:00Z'),
        roomNumber: 'Sala 1',
        ticketPrice: 25.0,
      });
      expect(sessionRepository.save).toHaveBeenCalledWith(mockSession);
      expect(seatRepository.save).toHaveBeenCalled();
      expect(result).toMatchObject({
        id: 'session-id-123',
        movieName: 'Avatar 3',
        roomNumber: 'Sala 1',
        ticketPrice: 25.0,
        totalSeats: 16,
        availableSeats: 16,
      });
    });

    it('should generate 16 seats with correct naming pattern', async () => {
      const createSessionDto: CreateSessionDto = {
        movieName: 'Test Movie',
        startTime: '2026-02-15T19:00:00Z',
        roomNumber: 'Sala 1',
        ticketPrice: 20.0,
        numberOfSeats: 16,
      };

      const mockSession = {
        id: 'session-id',
        movieName: 'Test Movie',
        startTime: new Date('2026-02-15T19:00:00Z'),
        roomNumber: 'Sala 1',
        ticketPrice: 20.0,
        isActive: true,
        createdAt: new Date(),
      } as Session;

      sessionRepository.create.mockReturnValue(mockSession);
      sessionRepository.save.mockResolvedValue(mockSession);

      let savedSeats: any[] = [];
      seatRepository.save.mockImplementation((seats: any) => {
        savedSeats = Array.isArray(seats) ? seats : [seats];
        return Promise.resolve(savedSeats as any);
      });

      await service.createSession(createSessionDto);

      expect(savedSeats).toHaveLength(16);
      expect(savedSeats[0]).toMatchObject({
        seatNumber: 'A1',
        row: 'A',
        status: SeatStatus.AVAILABLE,
        sessionId: 'session-id',
      });
      expect(savedSeats[7]).toMatchObject({
        seatNumber: 'A8',
        row: 'A',
      });
      expect(savedSeats[8]).toMatchObject({
        seatNumber: 'B1',
        row: 'B',
      });
    });
  });

  describe('getSessionAvailability', () => {
    it('should return session availability with all seats', async () => {
      const mockSession = {
        id: 'session-id',
        movieName: 'Avatar 3',
        startTime: new Date('2026-02-15T19:00:00Z'),
        roomNumber: 'Sala 1',
        ticketPrice: 25.0,
        seats: [
          {
            id: 'seat-1',
            seatNumber: 'A1',
            row: 'A',
            status: SeatStatus.AVAILABLE,
            sessionId: 'session-id',
          },
          {
            id: 'seat-2',
            seatNumber: 'A2',
            row: 'A',
            status: SeatStatus.RESERVED,
            sessionId: 'session-id',
          },
          {
            id: 'seat-3',
            seatNumber: 'A3',
            row: 'A',
            status: SeatStatus.SOLD,
            sessionId: 'session-id',
          },
        ],
      } as Session;

      sessionRepository.findOne.mockResolvedValue(mockSession);

      const result = await service.getSessionAvailability('session-id');

      expect(sessionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'session-id' },
        relations: ['seats'],
      });
      expect(result).toMatchObject({
        sessionId: 'session-id',
        movieName: 'Avatar 3',
        totalSeats: 3,
        availableSeats: 1,
      });
      expect(result.seats).toHaveLength(3);
      expect(result.seats[0]).toMatchObject({
        seatNumber: 'A1',
        row: 'A',
        status: SeatStatus.AVAILABLE,
        isAvailable: true,
      });
      expect(result.seats[1].isAvailable).toBe(false);
      expect(result.seats[2].isAvailable).toBe(false);
    });

    it('should throw NotFoundException when session does not exist', async () => {
      sessionRepository.findOne.mockResolvedValue(null);

      await expect(service.getSessionAvailability('non-existent-id')).rejects.toThrow(NotFoundException);
      await expect(service.getSessionAvailability('non-existent-id')).rejects.toThrow(
        'Session non-existent-id not found',
      );
    });
  });

  describe('getAllSessions', () => {
    it('should return all sessions with seat counts', async () => {
      const mockSessions = [
        {
          id: 'session-1',
          movieName: 'Avatar 3',
          startTime: new Date('2026-02-15T19:00:00Z'),
          roomNumber: 'Sala 1',
          ticketPrice: 25.0,
          isActive: true,
          createdAt: new Date(),
          seats: [
            { id: 'seat-1', status: SeatStatus.AVAILABLE },
            { id: 'seat-2', status: SeatStatus.AVAILABLE },
            { id: 'seat-3', status: SeatStatus.SOLD },
          ],
        },
        {
          id: 'session-2',
          movieName: 'Matrix 5',
          startTime: new Date('2026-02-16T20:00:00Z'),
          roomNumber: 'Sala 2',
          ticketPrice: 30.0,
          isActive: true,
          createdAt: new Date(),
          seats: [
            { id: 'seat-4', status: SeatStatus.AVAILABLE },
            { id: 'seat-5', status: SeatStatus.RESERVED },
          ],
        },
      ] as Session[];

      sessionRepository.find.mockResolvedValue(mockSessions);

      const result = await service.getAllSessions();

      expect(sessionRepository.find).toHaveBeenCalledWith({
        relations: ['seats'],
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'session-1',
        movieName: 'Avatar 3',
        totalSeats: 3,
        availableSeats: 2,
      });
      expect(result[1]).toMatchObject({
        id: 'session-2',
        movieName: 'Matrix 5',
        totalSeats: 2,
        availableSeats: 1,
      });
    });

    it('should return empty array when no sessions exist', async () => {
      sessionRepository.find.mockResolvedValue([]);

      const result = await service.getAllSessions();

      expect(result).toEqual([]);
    });
  });
});
