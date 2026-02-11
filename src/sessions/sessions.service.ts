import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session, Seat, SeatStatus } from '../entities';
import { CreateSessionDto, SessionResponseDto } from '../dto/session.dto';
import { SessionAvailabilityDto, SeatAvailabilityDto } from '../dto/availability.dto';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @InjectRepository(Session)
    private readonly sessionRepository: Repository<Session>,
    @InjectRepository(Seat)
    private readonly seatRepository: Repository<Seat>,
  ) {}

  async createSession(createSessionDto: CreateSessionDto): Promise<SessionResponseDto> {
    this.logger.log(`Creating session: ${createSessionDto.movieName}`);

    const session = this.sessionRepository.create({
      movieName: createSessionDto.movieName,
      startTime: new Date(createSessionDto.startTime),
      roomNumber: createSessionDto.roomNumber,
      ticketPrice: createSessionDto.ticketPrice,
    });

    const savedSession = await this.sessionRepository.save(session);

    // Create seats for the session
    const seats = this.generateSeats(createSessionDto.numberOfSeats, savedSession.id);
    await this.seatRepository.save(seats);

    this.logger.log(`Session created: ${savedSession.id} with ${createSessionDto.numberOfSeats} seats`);

    return {
      id: savedSession.id,
      movieName: savedSession.movieName,
      startTime: savedSession.startTime,
      roomNumber: savedSession.roomNumber,
      ticketPrice: savedSession.ticketPrice,
      isActive: savedSession.isActive,
      totalSeats: createSessionDto.numberOfSeats,
      availableSeats: createSessionDto.numberOfSeats,
      createdAt: savedSession.createdAt,
    };
  }

  async getSessionAvailability(sessionId: string): Promise<SessionAvailabilityDto> {
    this.logger.log(`Getting availability for session: ${sessionId}`);

    const session = await this.sessionRepository.findOne({
      where: { id: sessionId },
      relations: ['seats'],
    });

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    const seatAvailability: SeatAvailabilityDto[] = session.seats.map((seat) => ({
      seatNumber: seat.seatNumber,
      row: seat.row,
      status: seat.status,
      isAvailable: seat.status === SeatStatus.AVAILABLE,
    }));

    const availableSeats = session.seats.filter((seat) => seat.status === SeatStatus.AVAILABLE).length;

    return {
      sessionId: session.id,
      movieName: session.movieName,
      startTime: session.startTime,
      roomNumber: session.roomNumber,
      ticketPrice: session.ticketPrice,
      totalSeats: session.seats.length,
      availableSeats,
      seats: seatAvailability,
    };
  }

  async getAllSessions(): Promise<SessionResponseDto[]> {
    const sessions = await this.sessionRepository.find({
      relations: ['seats'],
    });

    return sessions.map((session) => {
      const availableSeats = session.seats.filter((seat) => seat.status === SeatStatus.AVAILABLE).length;

      return {
        id: session.id,
        movieName: session.movieName,
        startTime: session.startTime,
        roomNumber: session.roomNumber,
        ticketPrice: session.ticketPrice,
        isActive: session.isActive,
        totalSeats: session.seats.length,
        availableSeats,
        createdAt: session.createdAt,
      };
    });
  }

  private generateSeats(numberOfSeats: number, sessionId: string): Partial<Seat>[] {
    const seats: Partial<Seat>[] = [];
    const rows = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const seatsPerRow = 8;

    for (let i = 0; i < numberOfSeats; i++) {
      const rowIndex = Math.floor(i / seatsPerRow);
      const seatInRow = (i % seatsPerRow) + 1;
      const row = rows[rowIndex];

      seats.push({
        seatNumber: `${row}${seatInRow}`,
        row,
        status: SeatStatus.AVAILABLE,
        sessionId,
      });
    }

    return seats;
  }
}
