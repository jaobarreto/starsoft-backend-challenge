import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Sale } from '../entities';
import { UserPurchaseHistoryDto, SaleResponseDto } from '../dto/sale.dto';

@Injectable()
export class SalesService {
  private readonly logger = new Logger(SalesService.name);

  constructor(
    @InjectRepository(Sale)
    private readonly saleRepository: Repository<Sale>,
  ) {}

  async getUserPurchaseHistory(userId: string): Promise<UserPurchaseHistoryDto> {
    this.logger.log(`Getting purchase history for user: ${userId}`);

    const sales = await this.saleRepository.find({
      where: { userId },
      relations: ['seat', 'seat.session'],
      order: { createdAt: 'DESC' },
    });

    const purchases: SaleResponseDto[] = sales.map((sale) => ({
      id: sale.id,
      seatId: sale.seatId,
      seatNumber: sale.seat.seatNumber,
      userId: sale.userId,
      reservationId: sale.reservationId,
      amount: Number(sale.amount),
      movieName: sale.seat.session.movieName,
      sessionStartTime: sale.seat.session.startTime,
      roomNumber: sale.seat.session.roomNumber,
      paidAt: sale.paidAt,
      createdAt: sale.createdAt,
    }));

    const totalAmount = purchases.reduce((sum, purchase) => sum + purchase.amount, 0);

    return {
      userId,
      purchases,
      totalPurchases: purchases.length,
      totalAmount,
    };
  }

  async getAllSales(): Promise<SaleResponseDto[]> {
    const sales = await this.saleRepository.find({
      relations: ['seat', 'seat.session'],
      order: { createdAt: 'DESC' },
    });

    return sales.map((sale) => ({
      id: sale.id,
      seatId: sale.seatId,
      seatNumber: sale.seat.seatNumber,
      userId: sale.userId,
      reservationId: sale.reservationId,
      amount: Number(sale.amount),
      movieName: sale.seat.session.movieName,
      sessionStartTime: sale.seat.session.startTime,
      roomNumber: sale.seat.session.roomNumber,
      paidAt: sale.paidAt,
      createdAt: sale.createdAt,
    }));
  }
}
