import { IsString, IsDateString, IsNumber, Min, IsInt } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateSessionDto {
  @ApiProperty({ example: 'Avatar 3', description: 'Nome do filme' })
  @IsString()
  movieName: string;

  @ApiProperty({ example: '2026-02-15T19:00:00Z', description: 'Horário da sessão' })
  @IsDateString()
  startTime: string;

  @ApiProperty({ example: 'Sala 1', description: 'Número da sala' })
  @IsString()
  roomNumber: string;

  @ApiProperty({ example: 25.0, description: 'Preço do ingresso' })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  ticketPrice: number;

  @ApiProperty({ example: 16, description: 'Número de assentos', minimum: 16 })
  @IsInt()
  @Min(16)
  @Type(() => Number)
  numberOfSeats: number;
}

export class SessionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  movieName: string;

  @ApiProperty()
  startTime: Date;

  @ApiProperty()
  roomNumber: string;

  @ApiProperty()
  ticketPrice: number;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  totalSeats: number;

  @ApiProperty()
  availableSeats: number;

  @ApiProperty()
  createdAt: Date;
}
