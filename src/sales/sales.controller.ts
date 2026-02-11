import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SalesService } from './sales.service';
import { UserPurchaseHistoryDto, SaleResponseDto } from '../dto/sale.dto';

@ApiTags('sales')
@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar todas as vendas' })
  @ApiResponse({
    status: 200,
    description: 'Lista de vendas',
    type: [SaleResponseDto],
  })
  async getAllSales(): Promise<SaleResponseDto[]> {
    return this.salesService.getAllSales();
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Buscar histórico de compras de um usuário' })
  @ApiResponse({
    status: 200,
    description: 'Histórico de compras',
    type: UserPurchaseHistoryDto,
  })
  async getUserPurchaseHistory(@Param('userId') userId: string): Promise<UserPurchaseHistoryDto> {
    return this.salesService.getUserPurchaseHistory(userId);
  }
}
