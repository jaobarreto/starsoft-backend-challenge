import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SalesService } from './sales.service';
import { Sale } from '../entities';

/* eslint-disable @typescript-eslint/unbound-method */

describe('SalesService', () => {
  let service: SalesService;
  let saleRepository: jest.Mocked<Repository<Sale>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        {
          provide: getRepositoryToken(Sale),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SalesService>(SalesService);
    saleRepository = module.get(getRepositoryToken(Sale));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserPurchaseHistory', () => {
    it('should return user purchase history with correct calculations', async () => {
      const mockSales = [
        {
          id: 'sale-1',
          seatId: 'seat-1',
          userId: 'user-123',
          reservationId: 'res-1',
          amount: 25.0,
          paidAt: new Date('2026-02-01T10:00:00Z'),
          createdAt: new Date('2026-02-01T10:00:00Z'),
          seat: {
            seatNumber: 'A1',
            session: {
              movieName: 'Avatar 3',
              startTime: new Date('2026-02-15T19:00:00Z'),
              roomNumber: 'Sala 1',
            },
          },
        },
        {
          id: 'sale-2',
          seatId: 'seat-2',
          userId: 'user-123',
          reservationId: 'res-1',
          amount: 25.0,
          paidAt: new Date('2026-02-01T10:00:00Z'),
          createdAt: new Date('2026-02-01T10:00:00Z'),
          seat: {
            seatNumber: 'A2',
            session: {
              movieName: 'Avatar 3',
              startTime: new Date('2026-02-15T19:00:00Z'),
              roomNumber: 'Sala 1',
            },
          },
        },
      ] as Sale[];

      saleRepository.find.mockResolvedValue(mockSales);

      const result = await service.getUserPurchaseHistory('user-123');

      expect(saleRepository.find).toHaveBeenCalledWith({
        where: { userId: 'user-123' },
        relations: ['seat', 'seat.session'],
        order: { createdAt: 'DESC' },
      });
      expect(result).toMatchObject({
        userId: 'user-123',
        totalPurchases: 2,
        totalAmount: 50.0,
      });
      expect(result.purchases).toHaveLength(2);
      expect(result.purchases[0]).toMatchObject({
        id: 'sale-1',
        seatNumber: 'A1',
        amount: 25.0,
        movieName: 'Avatar 3',
        roomNumber: 'Sala 1',
      });
    });

    it('should return empty history for user with no purchases', async () => {
      saleRepository.find.mockResolvedValue([]);

      const result = await service.getUserPurchaseHistory('user-no-purchases');

      expect(result).toMatchObject({
        userId: 'user-no-purchases',
        totalPurchases: 0,
        totalAmount: 0,
        purchases: [],
      });
    });

    it('should correctly sum different ticket prices', async () => {
      const mockSales = [
        {
          id: 'sale-1',
          amount: 25.5,
          seat: {
            seatNumber: 'A1',
            session: { movieName: 'Movie 1', startTime: new Date(), roomNumber: 'Sala 1' },
          },
        },
        {
          id: 'sale-2',
          amount: 30.0,
          seat: {
            seatNumber: 'B1',
            session: { movieName: 'Movie 2', startTime: new Date(), roomNumber: 'Sala 2' },
          },
        },
        {
          id: 'sale-3',
          amount: 15.5,
          seat: {
            seatNumber: 'C1',
            session: { movieName: 'Movie 3', startTime: new Date(), roomNumber: 'Sala 3' },
          },
        },
      ] as Sale[];

      saleRepository.find.mockResolvedValue(mockSales);

      const result = await service.getUserPurchaseHistory('user-123');

      expect(result.totalAmount).toBe(71.0);
      expect(result.totalPurchases).toBe(3);
    });
  });

  describe('getAllSales', () => {
    it('should return all sales ordered by creation date', async () => {
      const mockSales = [
        {
          id: 'sale-1',
          seatId: 'seat-1',
          userId: 'user-1',
          reservationId: 'res-1',
          amount: 25.0,
          paidAt: new Date('2026-02-01T10:00:00Z'),
          createdAt: new Date('2026-02-01T10:00:00Z'),
          seat: {
            seatNumber: 'A1',
            session: {
              movieName: 'Avatar 3',
              startTime: new Date('2026-02-15T19:00:00Z'),
              roomNumber: 'Sala 1',
            },
          },
        },
        {
          id: 'sale-2',
          seatId: 'seat-2',
          userId: 'user-2',
          reservationId: 'res-2',
          amount: 30.0,
          paidAt: new Date('2026-02-02T11:00:00Z'),
          createdAt: new Date('2026-02-02T11:00:00Z'),
          seat: {
            seatNumber: 'B1',
            session: {
              movieName: 'Matrix 5',
              startTime: new Date('2026-02-16T20:00:00Z'),
              roomNumber: 'Sala 2',
            },
          },
        },
      ] as Sale[];

      saleRepository.find.mockResolvedValue(mockSales);

      const result = await service.getAllSales();

      expect(saleRepository.find).toHaveBeenCalledWith({
        relations: ['seat', 'seat.session'],
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'sale-1',
        userId: 'user-1',
        seatNumber: 'A1',
        amount: 25.0,
        movieName: 'Avatar 3',
      });
      expect(result[1]).toMatchObject({
        id: 'sale-2',
        userId: 'user-2',
        seatNumber: 'B1',
        amount: 30.0,
        movieName: 'Matrix 5',
      });
    });

    it('should return empty array when no sales exist', async () => {
      saleRepository.find.mockResolvedValue([]);

      const result = await service.getAllSales();

      expect(result).toEqual([]);
    });

    it('should convert decimal amounts to numbers', async () => {
      const mockSales = [
        {
          id: 'sale-1',
          amount: 25.5,
          seatId: 'seat-1',
          userId: 'user-1',
          reservationId: 'res-1',
          paidAt: new Date(),
          createdAt: new Date(),
          seat: {
            seatNumber: 'A1',
            session: { movieName: 'Movie 1', startTime: new Date(), roomNumber: 'Sala 1' },
          },
        },
      ] as Sale[];

      saleRepository.find.mockResolvedValue(mockSales);

      const result = await service.getAllSales();

      expect(typeof result[0].amount).toBe('number');
      expect(result[0].amount).toBe(25.5);
    });
  });
});
