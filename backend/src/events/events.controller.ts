import { 
  Controller, Get, Post, Put, Param, Body, Query, 
  UseGuards, Res, HttpStatus, Headers, UnauthorizedException 
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiHeader } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { EventsService } from './events.service';
import { EventSource, EventStatus } from '@prisma/client';
import { CreateEmailEventDto, CreateDialpadEventDto, UpdateEventStatusDto } from './dto/event.dto';
import { ConfigService } from '@nestjs/config';

@ApiTags('events')
@Controller('events')
export class EventsController {
  constructor(
    private eventsService: EventsService,
    private configService: ConfigService,
  ) {}

  private isInternalRequest(apiKey: string | undefined): boolean {
    const internalKey = this.configService.get<string>('INTERNAL_API_KEY') || 'internal-service-key';
    return apiKey === internalKey;
  }

  // Map frontend status names to backend enum values
  private mapStatus(status: string): EventStatus | undefined {
    const statusMap: Record<string, EventStatus> = {
      'NEW': EventStatus.pending,
      'ESCALATING': EventStatus.escalated,
      'ACKNOWLEDGED': EventStatus.acknowledged,
      'DOWNGRADED': EventStatus.downgraded,
      'MISSED': EventStatus.missed,
      'CLOSED': EventStatus.closed,
      // Also support direct enum values
      'pending': EventStatus.pending,
      'escalated': EventStatus.escalated,
      'acknowledged': EventStatus.acknowledged,
      'downgraded': EventStatus.downgraded,
      'missed': EventStatus.missed,
      'closed': EventStatus.closed,
    };
    return statusMap[status];
  }

  @Get()
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all events with filters' })
  @ApiQuery({ name: 'status', required: false, description: 'Comma-separated statuses' })
  @ApiQuery({ name: 'source', required: false, enum: EventSource })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  async findAll(
    @Query('status') status?: string,
    @Query('source') source?: EventSource,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    // Handle comma-separated statuses
    let statuses: EventStatus[] | undefined;
    if (status) {
      statuses = status.split(',')
        .map(s => this.mapStatus(s.trim()))
        .filter((s): s is EventStatus => s !== undefined);
    }

    return this.eventsService.findAll({
      statuses,
      source,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
  }

  @Get('active-escalations')
  @ApiHeader({ name: 'x-internal-key', required: false })
  @ApiOperation({ summary: 'Get currently active escalations' })
  async getActiveEscalations(
    @Headers('x-internal-key') internalKey?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    // Allow internal service calls or JWT auth
    if (!this.isInternalRequest(internalKey) && !authHeader) {
      throw new UnauthorizedException('Authorization required');
    }
    return this.eventsService.getActiveEscalations();
  }

  @Get('acknowledged')
  @ApiHeader({ name: 'x-internal-key', required: false })
  @ApiOperation({ summary: 'Get acknowledged events, optionally filtered by owner' })
  @ApiQuery({ name: 'ownerId', required: false })
  async getAcknowledged(
    @Query('ownerId') ownerId?: string,
    @Headers('x-internal-key') internalKey?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    // Allow internal service calls or JWT auth
    if (!this.isInternalRequest(internalKey) && !authHeader) {
      throw new UnauthorizedException('Authorization required');
    }
    return this.eventsService.getAcknowledgedEvents(ownerId);
  }

  @Get('export')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Export events to CSV' })
  async exportCsv(
    @Res() res: Response,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const csv = await this.eventsService.exportToCsv({
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=events.csv');
    res.status(HttpStatus.OK).send(csv);
  }

  @Get(':id')
  @ApiHeader({ name: 'x-internal-key', required: false })
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get event by ID' })
  async findOne(
    @Param('id') id: string,
    @Headers('x-internal-key') internalKey?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    // Allow internal service calls or JWT auth
    if (!this.isInternalRequest(internalKey) && !authHeader) {
      throw new UnauthorizedException('Authorization required');
    }
    return this.eventsService.findById(id);
  }

  @Post('email')
  @ApiHeader({ name: 'x-internal-key', required: false })
  @ApiOperation({ summary: 'Create email event (from email poller)' })
  async createEmailEvent(
    @Body() dto: CreateEmailEventDto,
    @Headers('x-internal-key') internalKey?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    // Allow internal service calls or JWT auth
    if (!this.isInternalRequest(internalKey) && !authHeader) {
      throw new UnauthorizedException('Authorization required');
    }
    return this.eventsService.createEmailEvent({
      subject: dto.subject,
      body: dto.body,
      senderEmail: dto.senderEmail,
      senderDomain: dto.senderDomain,
      receivedAt: dto.receivedAt ? new Date(dto.receivedAt) : new Date(),
      emergencyScore: dto.emergencyScore,
      aiSummary: dto.aiSummary,
    });
  }

  @Post('dialpad')
  @ApiHeader({ name: 'x-internal-key', required: false })
  @ApiOperation({ summary: 'Create Dialpad event (from webhook or internal service)' })
  async createDialpadEvent(
    @Body() dto: CreateDialpadEventDto,
    @Headers('x-internal-key') internalKey?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    // Allow internal service calls or JWT auth
    if (!this.isInternalRequest(internalKey) && !authHeader) {
      throw new UnauthorizedException('Authorization required');
    }
    return this.eventsService.createDialpadEvent({
      senderPhone: dto.senderPhone,
      senderName: dto.senderName,
      voicemailTranscription: dto.voicemailTranscription,
      voicemailUrl: dto.voicemailUrl,
      receivedAt: new Date(dto.receivedAt),
      callId: dto.callId,
      state: dto.state,
      emergencyScore: dto.emergencyScore,
      priority: dto.priority,
      triageReasoning: dto.triageReasoning,
      issueSummary: dto.issueSummary,
    });
  }

  @Put(':id/status')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update event status' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateEventStatusDto,
  ) {
    return this.eventsService.updateStatus(id, dto.status, dto.userId);
  }

  @Post(':id/downgrade')
  @ApiHeader({ name: 'x-internal-key', required: false })
  @ApiOperation({ summary: 'Downgrade event to non-emergency (by owner)' })
  async downgradeEvent(
    @Param('id') id: string,
    @Body() body: { userId: string; reason: string },
    @Headers('x-internal-key') internalKey?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    // Allow internal service calls or JWT auth
    if (!this.isInternalRequest(internalKey) && !authHeader) {
      throw new UnauthorizedException('Authorization required');
    }
    return this.eventsService.downgradeEvent(id, body.userId, body.reason);
  }
}
