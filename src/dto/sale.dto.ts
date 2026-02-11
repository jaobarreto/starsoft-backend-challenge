import { ApiProperty } from '@nestjs/swagger';

export class SaleResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  seatId: string;

  @ApiProperty()
  seatNumber: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  reservationId: string;

  @ApiProperty()
  amount: number;

  @ApiProperty()
  movieName: string;

  @ApiProperty()
  sessionStartTime: Date;

  @ApiProperty()
  roomNumber: string;

  @ApiProperty()
  paidAt: Date;

  @ApiProperty()
  createdAt: Date;
}

export class UserPurchaseHistoryDto {
  @ApiProperty()
  userId: string;

  @ApiProperty({ type: [SaleResponseDto] })
  purchases: SaleResponseDto[];

  @ApiProperty()
  totalPurchases: number;

  @ApiProperty()
  totalAmount: number;
}
