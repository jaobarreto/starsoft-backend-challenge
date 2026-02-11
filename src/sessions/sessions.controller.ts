import { Controller, Post, Get, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SessionsService } from './sessions.service';
import { CreateSessionDto, SessionResponseDto } from '../dto/session.dto';
import { SessionAvailabilityDto } from '../dto/availability.dto';

@ApiTags('sessions')
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Criar uma nova sessão de cinema' })
  @ApiResponse({ status: 201, description: 'Sessão criada com sucesso', type: SessionResponseDto })
  async createSession(@Body() createSessionDto: CreateSessionDto): Promise<SessionResponseDto> {
    return this.sessionsService.createSession(createSessionDto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar todas as sessões' })
  @ApiResponse({ status: 200, description: 'Lista de sessões', type: [SessionResponseDto] })
  async getAllSessions(): Promise<SessionResponseDto[]> {
    return this.sessionsService.getAllSessions();
  }

  @Get(':id/availability')
  @ApiOperation({ summary: 'Consultar disponibilidade de assentos de uma sessão' })
  @ApiResponse({
    status: 200,
    description: 'Disponibilidade da sessão',
    type: SessionAvailabilityDto,
  })
  async getSessionAvailability(@Param('id') sessionId: string): Promise<SessionAvailabilityDto> {
    return this.sessionsService.getSessionAvailability(sessionId);
  }
}
