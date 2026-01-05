import {
  Controller, Get, Post, Put, Param, Body, Query,
  UseGuards, Res, HttpStatus, Headers, UnauthorizedException
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiHeader } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { EventsService } from './events.service';
import { Event, EventSource, EventStatus } from '@prisma/client';
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

  // Map frontend status names to backend enum values (for filtering)
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

  // Map backend status to frontend status (for responses)
  private mapStatusToFrontend(status: EventStatus): string {
    const statusMap: Record<EventStatus, string> = {
      [EventStatus.pending]: 'NEW',
      [EventStatus.escalated]: 'ESCALATING',
      [EventStatus.acknowledged]: 'ACKNOWLEDGED',
      [EventStatus.downgraded]: 'DOWNGRADED',
      [EventStatus.missed]: 'MISSED',
      [EventStatus.closed]: 'CLOSED',
    };
    return statusMap[status] || status;
  }

  // Map backend source to frontend source (for responses)
  private mapSourceToFrontend(source: EventSource): string {
    return source.toUpperCase();
  }

  // Safely convert date to ISO string
  private toISOStringSafe(date: Date | string | null | undefined): string | null {
    if (!date) return null;
    try {
      if (date instanceof Date) {
        return date.toISOString();
      }
      // If it's already a string, validate it's a valid date
      const parsed = new Date(date);
      if (isNaN(parsed.getTime())) return null;
      return parsed.toISOString();
    } catch {
      return null;
    }
  }

  // Transform event for frontend response
  private transformEvent(event: Event & { acknowledgedBy?: any; escalationLogs?: any[]; acknowledgments?: any[] }): any {
    const emergencyScore = event.emergencyScore ? Number(event.emergencyScore) : 0;
    return {
      ...event,
      status: this.mapStatusToFrontend(event.status),
      source: this.mapSourceToFrontend(event.source),
      emergencyScore,
      isEmergency: emergencyScore >= 0.6,
      createdAt: this.toISOStringSafe(event.createdAt) || new Date().toISOString(),
      updatedAt: this.toISOStringSafe(event.updatedAt) || new Date().toISOString(),
      receivedAt: this.toISOStringSafe(event.receivedAt) || new Date().toISOString(),
      acknowledgedAt: this.toISOStringSafe(event.acknowledgedAt),
    };
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
  @ApiQuery({ name: 'page', required: false })
  async findAll(
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('page') page?: string,
  ) {
    // Handle comma-separated statuses
    let statuses: EventStatus[] | undefined;
    if (status) {
      statuses = status.split(',')
        .map(s => this.mapStatus(s.trim()))
        .filter((s): s is EventStatus => s !== undefined);
    }

    // Map source to lowercase for backend
    const mappedSource = source ? source.toLowerCase() as EventSource : undefined;

    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 10;
    const offsetNum = offset ? parseInt(offset, 10) : (pageNum - 1) * limitNum;

    const { events, total } = await this.eventsService.findAll({
      statuses,
      source: mappedSource,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      limit: limitNum,
      offset: offsetNum,
    });

    // Transform events for frontend
    const transformedEvents = events.map(event => this.transformEvent(event));

    // Return paginated response in frontend expected format
    return {
      data: transformedEvents,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    };
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
    const events = await this.eventsService.getActiveEscalations();
    return events.map(event => this.transformEvent(event));
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
    const events = await this.eventsService.getAcknowledgedEvents(ownerId);
    return events.map(event => this.transformEvent(event));
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
    const event = await this.eventsService.findById(id);
    if (!event) return null;
    return this.transformEvent(event);
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
    const event = await this.eventsService.createEmailEvent({
      subject: dto.subject,
      body: dto.body,
      senderEmail: dto.senderEmail,
      senderDomain: dto.senderDomain,
      receivedAt: dto.receivedAt ? new Date(dto.receivedAt) : new Date(),
      emergencyScore: dto.emergencyScore,
      aiSummary: dto.aiSummary,
    });
    return this.transformEvent(event);
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
    const event = await this.eventsService.createDialpadEvent({
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
    return this.transformEvent(event);
  }

  @Put(':id/status')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update event status' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateEventStatusDto,
  ) {
    const event = await this.eventsService.updateStatus(id, dto.status, dto.userId);
    return this.transformEvent(event);
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
    const event = await this.eventsService.downgradeEvent(id, body.userId, body.reason);
    return this.transformEvent(event);
  }
}
