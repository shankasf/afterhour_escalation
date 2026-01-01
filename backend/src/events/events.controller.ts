import { 
  Controller, Get, Post, Put, Param, Body, Query, 
  UseGuards, Res, HttpStatus 
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';
import { EventsService } from './events.service';
import { EventSource, EventStatus } from '@prisma/client';
import { CreateEmailEventDto, CreateDialpadEventDto, UpdateEventStatusDto } from './dto/event.dto';

@ApiTags('events')
@ApiBearerAuth()
@Controller('events')
@UseGuards(AuthGuard('jwt'))
export class EventsController {
  constructor(private eventsService: EventsService) {}

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
  @ApiOperation({ summary: 'Get currently active escalations' })
  async getActiveEscalations() {
    return this.eventsService.getActiveEscalations();
  }

  @Get('export')
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
  @ApiOperation({ summary: 'Get event by ID' })
  async findOne(@Param('id') id: string) {
    return this.eventsService.findById(id);
  }

  @Post('email')
  @ApiOperation({ summary: 'Create email event (from email poller)' })
  async createEmailEvent(@Body() dto: CreateEmailEventDto) {
    return this.eventsService.createEmailEvent({
      subject: dto.subject,
      body: dto.body,
      senderEmail: dto.senderEmail,
      senderDomain: dto.senderDomain,
      receivedAt: new Date(dto.receivedAt),
    });
  }

  @Post('dialpad')
  @ApiOperation({ summary: 'Create Dialpad event (from webhook)' })
  async createDialpadEvent(@Body() dto: CreateDialpadEventDto) {
    return this.eventsService.createDialpadEvent({
      senderPhone: dto.senderPhone,
      voicemailTranscription: dto.voicemailTranscription,
      voicemailUrl: dto.voicemailUrl,
      receivedAt: new Date(dto.receivedAt),
    });
  }

  @Put(':id/status')
  @ApiOperation({ summary: 'Update event status' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateEventStatusDto,
  ) {
    return this.eventsService.updateStatus(id, dto.status, dto.userId);
  }
}
