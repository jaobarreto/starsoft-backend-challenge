import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';
import { Session, Seat, Reservation, Sale, SeatStatus, ReservationStatus } from '../src/entities';
import { SessionAvailabilityDto } from '../src/dto/availability.dto';
import { ReservationResponseDto } from '../src/dto/reservation.dto';
import { SaleResponseDto, UserPurchaseHistoryDto } from '../src/dto/sale.dto';
import { SessionResponseDto } from '../src/dto/session.dto';

describe('Reservations System (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let testSessionId: string;
  let testUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Apply same validation pipe as main.ts
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    await app.init();

    dataSource = app.get(DataSource);
    testUserId = 'test-user-e2e-' + Date.now();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean database before each test
    await dataSource.getRepository(Sale).createQueryBuilder().delete().execute();
    await dataSource.getRepository(Reservation).createQueryBuilder().delete().execute();
    await dataSource.getRepository(Seat).createQueryBuilder().delete().execute();
    await dataSource.getRepository(Session).createQueryBuilder().delete().execute();

    // Create a test session with seats
    const response = await request(app.getHttpServer())
      .post('/sessions')
      .send({
        movieName: 'E2E Test Movie',
        startTime: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
        roomNumber: 'E2E Room 1',
        ticketPrice: 25.0,
        numberOfSeats: 16,
      })
      .expect(201);

    testSessionId = (response.body as SessionResponseDto).id;
  });

  describe('1. Complete Flow: Reservation → Purchase', () => {
    it('should successfully create reservation and confirm payment', async () => {
      // Step 1: Create reservation
      const reservationResponse = await request(app.getHttpServer())
        .post('/reservations')
        .send({
          sessionId: testSessionId,
          seatNumbers: ['A1', 'A2'],
          userId: testUserId,
        })
        .expect(201);

      const reservations = reservationResponse.body as ReservationResponseDto[];
      expect(reservations).toHaveLength(2);
      expect(reservations[0]).toMatchObject({
        seatNumber: 'A1',
        userId: testUserId,
        status: ReservationStatus.PENDING,
      });

      const reservationId = reservations[0].id;

      // Step 2: Check seat status is RESERVED
      const availabilityResponse = await request(app.getHttpServer())
        .get(`/sessions/${testSessionId}/availability`)
        .expect(200);

      const availability = availabilityResponse.body as SessionAvailabilityDto;
      const seatA1 = availability.seats.find((s) => s.seatNumber === 'A1');
      expect(seatA1?.status).toBe(SeatStatus.RESERVED);
      expect(seatA1?.isAvailable).toBe(false);

      // Step 3: Confirm payment
      const paymentResponse = await request(app.getHttpServer())
        .post('/reservations/confirm-payment')
        .send({
          reservationId,
          userId: testUserId,
        })
        .expect(200);

      const sale = paymentResponse.body as SaleResponseDto;
      expect(sale).toMatchObject({
        userId: testUserId,
        reservationId,
        amount: 25.0,
        movieName: 'E2E Test Movie',
      });

      // Step 4: Verify seat is now SOLD
      const finalAvailabilityResponse = await request(app.getHttpServer())
        .get(`/sessions/${testSessionId}/availability`)
        .expect(200);

      const finalAvailability = finalAvailabilityResponse.body as SessionAvailabilityDto;
      const finalSeatA1 = finalAvailability.seats.find((s) => s.seatNumber === 'A1');
      expect(finalSeatA1?.status).toBe(SeatStatus.SOLD);
      expect(finalSeatA1?.isAvailable).toBe(false);

      // Step 5: Verify sale was created
      const salesResponse = await request(app.getHttpServer()).get(`/sales/user/${testUserId}`).expect(200);

      const userHistory = salesResponse.body as UserPurchaseHistoryDto;
      expect(userHistory.totalPurchases).toBe(2); // A1 and A2
      expect(userHistory.purchases).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            seatNumber: 'A1',
            userId: testUserId,
            amount: 25.0,
          }),
        ]),
      );
    });

    it('should allow payment idempotency (calling confirm-payment twice)', async () => {
      // Create reservation
      const reservationResponse = await request(app.getHttpServer())
        .post('/reservations')
        .send({
          sessionId: testSessionId,
          seatNumbers: ['B1'],
          userId: testUserId,
        })
        .expect(201);

      const reservationId = (reservationResponse.body as ReservationResponseDto[])[0].id;

      // First payment
      const firstPayment = await request(app.getHttpServer())
        .post('/reservations/confirm-payment')
        .send({
          reservationId,
          userId: testUserId,
        })
        .expect(200);

      // Second payment (idempotent)
      const secondPayment = await request(app.getHttpServer())
        .post('/reservations/confirm-payment')
        .send({
          reservationId,
          userId: testUserId,
        })
        .expect(200);

      // Both should return the same sale
      const firstSale = firstPayment.body as SaleResponseDto;
      const secondSale = secondPayment.body as SaleResponseDto;
      expect(firstSale.id).toBe(secondSale.id);
      expect(secondSale).toMatchObject({
        userId: testUserId,
        reservationId,
        seatNumber: 'B1',
      });

      // Verify only one sale exists
      const salesResponse = await request(app.getHttpServer()).get(`/sales/user/${testUserId}`).expect(200);

      const userHistory = salesResponse.body as UserPurchaseHistoryDto;
      expect(userHistory.totalPurchases).toBe(1);
    });
  });

  describe('2. Double Reservation Prevention (Concurrency)', () => {
    it('should prevent double reservation on same seat', async () => {
      const user1 = 'user1-' + Date.now();
      const user2 = 'user2-' + Date.now();

      // User 1 reserves seat A3
      await request(app.getHttpServer())
        .post('/reservations')
        .send({
          sessionId: testSessionId,
          seatNumbers: ['A3'],
          userId: user1,
        })
        .expect(201);

      // User 2 tries to reserve the same seat A3 - should fail
      const response = await request(app.getHttpServer())
        .post('/reservations')
        .send({
          sessionId: testSessionId,
          seatNumbers: ['A3'],
          userId: user2,
        })
        .expect(400);

      const errorResponse = response.body as { message: string | string[] };
      const message = Array.isArray(errorResponse.message) ? errorResponse.message.join(' ') : errorResponse.message;
      expect(message).toContain('not available');
    });

    it('should prevent concurrent reservations with pessimistic locking', async () => {
      const user1 = 'user1-concurrent-' + Date.now();
      const user2 = 'user2-concurrent-' + Date.now();

      // Simulate concurrent requests
      const results = await Promise.allSettled([
        request(app.getHttpServer())
          .post('/reservations')
          .send({
            sessionId: testSessionId,
            seatNumbers: ['B3', 'B4'],
            userId: user1,
          }),
        request(app.getHttpServer())
          .post('/reservations')
          .send({
            sessionId: testSessionId,
            seatNumbers: ['B3', 'B4'],
            userId: user2,
          }),
      ]);

      // One should succeed, one should fail
      interface SupertestResponse {
        status: number;
        body: unknown;
      }
      const succeeded = results.filter(
        (r) => r.status === 'fulfilled' && (r.value as SupertestResponse).status === 201,
      );
      const failed = results.filter(
        (r) =>
          r.status === 'fulfilled' &&
          ((r.value as SupertestResponse).status === 400 || (r.value as SupertestResponse).status === 409),
      );

      expect(succeeded).toHaveLength(1);
      expect(failed.length).toBeGreaterThanOrEqual(1);

      // Verify only one reservation exists
      const reservationsUser1 = await request(app.getHttpServer()).get(`/reservations/user/${user1}`).expect(200);

      const reservationsUser2 = await request(app.getHttpServer()).get(`/reservations/user/${user2}`).expect(200);

      const reservations1 = reservationsUser1.body as ReservationResponseDto[];
      const reservations2 = reservationsUser2.body as ReservationResponseDto[];
      const totalReservations = reservations1.length + reservations2.length;
      expect(totalReservations).toBe(2); // Only 2 seats (B3, B4) reserved by one user
    });

    it('should handle sorted seat numbers to prevent deadlock', async () => {
      const user1 = 'user1-deadlock-' + Date.now();
      const user2 = 'user2-deadlock-' + Date.now();

      // User1: reserves B5, B6, B7 in order
      // User2: tries B7, B6, B5 in reverse (would cause deadlock without sorting)
      const results = await Promise.allSettled([
        request(app.getHttpServer())
          .post('/reservations')
          .send({
            sessionId: testSessionId,
            seatNumbers: ['B5', 'B6', 'B7'],
            userId: user1,
          }),
        request(app.getHttpServer())
          .post('/reservations')
          .send({
            sessionId: testSessionId,
            seatNumbers: ['B7', 'B6', 'B5'],
            userId: user2,
          }),
      ]);

      // One should succeed (lock acquired in consistent order prevents deadlock)
      interface SupertestResponse {
        status: number;
        body: unknown;
      }
      const succeeded = results.filter(
        (r) => r.status === 'fulfilled' && (r.value as SupertestResponse).status === 201,
      );
      expect(succeeded).toHaveLength(1);

      // Verify seats are reserved by only one user
      const availabilityResponse = await request(app.getHttpServer())
        .get(`/sessions/${testSessionId}/availability`)
        .expect(200);

      const availability = availabilityResponse.body as SessionAvailabilityDto;
      const b5 = availability.seats.find((s) => s.seatNumber === 'B5');
      const b6 = availability.seats.find((s) => s.seatNumber === 'B6');
      const b7 = availability.seats.find((s) => s.seatNumber === 'B7');

      expect(b5?.status).toBe(SeatStatus.RESERVED);
      expect(b6?.status).toBe(SeatStatus.RESERVED);
      expect(b7?.status).toBe(SeatStatus.RESERVED);
    });
  });

  describe('Additional Edge Cases', () => {
    it('should reject reservation for non-existent session', async () => {
      const response = await request(app.getHttpServer())
        .post('/reservations')
        .send({
          sessionId: '00000000-0000-0000-0000-000000000000',
          seatNumbers: ['A1'],
          userId: testUserId,
        })
        .expect(404);

      const errorResponse = response.body as { message: string | string[] };
      const message = Array.isArray(errorResponse.message) ? errorResponse.message.join(' ') : errorResponse.message;
      expect(message).toContain('not found');
    });

    it('should reject reservation for non-existent seat', async () => {
      const response = await request(app.getHttpServer())
        .post('/reservations')
        .send({
          sessionId: testSessionId,
          seatNumbers: ['Z99'], // Non-existent seat
          userId: testUserId,
        })
        .expect(404);

      const errorResponse = response.body as { message: string | string[] };
      const message = Array.isArray(errorResponse.message) ? errorResponse.message.join(' ') : errorResponse.message;
      expect(message).toContain('not found');
    });

    it('should reject payment for non-existent reservation', async () => {
      await request(app.getHttpServer())
        .post('/reservations/confirm-payment')
        .send({
          reservationId: '00000000-0000-0000-0000-000000000000',
          userId: testUserId,
        })
        .expect(404);
    });

    it('should reject payment from different user', async () => {
      // Create reservation with user1
      const reservationResponse = await request(app.getHttpServer())
        .post('/reservations')
        .send({
          sessionId: testSessionId,
          seatNumbers: ['B6'],
          userId: 'user1-owner',
        })
        .expect(201);

      const reservations = reservationResponse.body as ReservationResponseDto[];
      const reservationId = reservations[0].id;

      // Try to confirm with different user
      await request(app.getHttpServer())
        .post('/reservations/confirm-payment')
        .send({
          reservationId,
          userId: 'user2-attacker',
        })
        .expect(404); // Not found because userId doesn't match
    });
  });
});
