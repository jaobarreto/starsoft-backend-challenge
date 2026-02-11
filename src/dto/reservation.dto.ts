import { IsString, IsArray, ArrayMinSize, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateReservationDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000', description: 'ID da sessão' })
  @IsUUID()
  sessionId: string;

  @ApiProperty({ example: ['A1', 'A2'], description: 'Lista de assentos para reservar' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  seatNumbers: string[];

  @ApiProperty({ example: 'user123', description: 'ID do usuário' })
  @IsString()
  userId: string;
}

export class ReservationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  seatId: string;

  @ApiProperty()
  seatNumber: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty()
  createdAt: Date;
}

export class ConfirmPaymentDto {
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000', description: 'ID da reserva' })
  @IsUUID()
  reservationId: string;

  @ApiProperty({ example: 'user123', description: 'ID do usuário' })
  @IsString()
  userId: string;
}
