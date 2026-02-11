import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto, ReservationResponseDto, ConfirmPaymentDto } from '../dto/reservation.dto';
import { SaleResponseDto } from '../dto/sale.dto';

@ApiTags('reservations')
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Criar uma nova reserva de assento(s)' })
  @ApiResponse({
    status: 201,
    description: 'Reserva criada com sucesso',
    type: [ReservationResponseDto],
  })
  async createReservation(@Body() createReservationDto: CreateReservationDto): Promise<ReservationResponseDto[]> {
    return this.reservationsService.createReservation(createReservationDto);
  }

  @Post('confirm-payment')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmar pagamento de uma reserva' })
  @ApiResponse({ status: 200, description: 'Pagamento confirmado', type: SaleResponseDto })
  async confirmPayment(@Body() confirmPaymentDto: ConfirmPaymentDto): Promise<SaleResponseDto> {
    return this.reservationsService.confirmPayment(confirmPaymentDto);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Buscar reservas de um usuário' })
  @ApiResponse({
    status: 200,
    description: 'Lista de reservas',
    type: [ReservationResponseDto],
  })
  async getUserReservations(@Param('userId') userId: string): Promise<ReservationResponseDto[]> {
    return this.reservationsService.getUserReservations(userId);
  }
}
