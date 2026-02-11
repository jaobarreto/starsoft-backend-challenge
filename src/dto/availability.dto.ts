import { ApiProperty } from '@nestjs/swagger';

export class SeatAvailabilityDto {
  @ApiProperty()
  seatNumber: string;

  @ApiProperty()
  row: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  isAvailable: boolean;
}

export class SessionAvailabilityDto {
  @ApiProperty()
  sessionId: string;

  @ApiProperty()
  movieName: string;

  @ApiProperty()
  startTime: Date;

  @ApiProperty()
  roomNumber: string;

  @ApiProperty()
  ticketPrice: number;

  @ApiProperty()
  totalSeats: number;

  @ApiProperty()
  availableSeats: number;

  @ApiProperty({ type: [SeatAvailabilityDto] })
  seats: SeatAvailabilityDto[];
}
