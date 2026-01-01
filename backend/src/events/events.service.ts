import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Event, EventSource, EventStatus, Prisma } from '@prisma/client';
import { AiServiceClient } from '../ai-service/ai-service.client';
import { WebsocketGateway } from '../websocket/websocket.gateway';

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    private prisma: PrismaService,
    private aiService: AiServiceClient,
    private wsGateway: WebsocketGateway,
  ) {}

  async findAll(filters?: {
    statuses?: EventStatus[];
    source?: EventSource;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ events: Event[]; total: number }> {
    const where: Prisma.EventWhereInput = {};

    if (filters?.statuses && filters.statuses.length > 0) {
      where.status = { in: filters.statuses };
    }
    if (filters?.source) where.source = filters.source;
    if (filters?.startDate || filters?.endDate) {
      where.receivedAt = {};
      if (filters.startDate) where.receivedAt.gte = filters.startDate;
      if (filters.endDate) where.receivedAt.lte = filters.endDate;
    }

    const [events, total] = await Promise.all([
      this.prisma.event.findMany({
        where,
        orderBy: { receivedAt: 'desc' },
        take: filters?.limit || 50,
        skip: filters?.offset || 0,
        include: {
          acknowledgedBy: {
            select: { id: true, name: true, email: true },
          },
        },
      }),
      this.prisma.event.count({ where }),
    ]);

    return { events, total };
  }

  async findById(id: string): Promise<Event | null> {
    return this.prisma.event.findUnique({
      where: { id },
      include: {
        acknowledgedBy: {
          select: { id: true, name: true, email: true },
        },
        escalationLogs: {
          include: {
            user: { select: { id: true, name: true, phoneNumber: true } },
          },
          orderBy: { attemptNumber: 'asc' },
        },
        acknowledgments: {
          include: {
            user: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  async createEmailEvent(data: {
    subject: string;
    body: string;
    senderEmail: string;
    senderDomain: string;
    receivedAt: Date;
  }): Promise<Event> {
    this.logger.log(`Creating email event from ${data.senderEmail}`);

    // Create the event first
    const event = await this.prisma.event.create({
      data: {
        source: EventSource.email,
        subject: data.subject,
        body: data.body,
        senderEmail: data.senderEmail,
        senderDomain: data.senderDomain,
        receivedAt: data.receivedAt,
        status: EventStatus.pending,
      },
    });

    // Call AI service to classify
    try {
      const classification = await this.aiService.classifyEmail({
        subject: data.subject,
        body: data.body,
        senderDomain: data.senderDomain,
      });

      // Update event with classification results
      const updatedEvent = await this.prisma.event.update({
        where: { id: event.id },
        data: {
          emergencyScore: classification.emergencyScore,
          extractedContext: classification.extractedContext as any,
          status: classification.shouldEscalate 
            ? EventStatus.escalated 
            : EventStatus.pending,
        },
      });

      // Emit websocket event
      this.wsGateway.emitNewEvent(updatedEvent);

      return updatedEvent;
    } catch (error) {
      this.logger.error(`Failed to classify email: ${error.message}`);
      // Still return the event even if classification fails
      this.wsGateway.emitNewEvent(event);
      return event;
    }
  }

  async createDialpadEvent(data: {
    senderPhone: string;
    voicemailTranscription?: string;
    voicemailUrl?: string;
    receivedAt: Date;
  }): Promise<Event> {
    this.logger.log(`Creating Dialpad event from ${data.senderPhone}`);

    // Dialpad events are always high priority - skip scoring
    const event = await this.prisma.event.create({
      data: {
        source: EventSource.dialpad,
        senderPhone: data.senderPhone,
        body: data.voicemailTranscription,
        voicemailTranscription: data.voicemailTranscription,
        voicemailUrl: data.voicemailUrl,
        receivedAt: data.receivedAt,
        status: EventStatus.escalated, // Always escalate dialpad events
        emergencyScore: 1.0, // High confidence
      },
    });

    // Emit websocket event
    this.wsGateway.emitNewEvent(event);

    return event;
  }

  async updateStatus(id: string, status: EventStatus, userId?: string): Promise<Event> {
    const updateData: Prisma.EventUpdateInput = { status };

    if (status === EventStatus.acknowledged && userId) {
      updateData.acknowledgedBy = { connect: { id: userId } };
      updateData.acknowledgedAt = new Date();
    }

    const event = await this.prisma.event.update({
      where: { id },
      data: updateData,
    });

    this.wsGateway.emitEventUpdate(event);
    return event;
  }

  async setEscalationLadder(id: string, ladder: any[]): Promise<Event> {
    return this.prisma.event.update({
      where: { id },
      data: { escalationLadderSnapshot: ladder as any },
    });
  }

  async getActiveEscalations(): Promise<Event[]> {
    return this.prisma.event.findMany({
      where: { status: EventStatus.escalated },
      include: {
        escalationLogs: {
          orderBy: { attemptNumber: 'desc' },
          take: 1,
        },
      },
    });
  }

  async exportToCsv(filters?: {
    startDate?: Date;
    endDate?: Date;
  }): Promise<string> {
    const { events } = await this.findAll({
      ...filters,
      limit: 10000,
    });

    const headers = [
      'ID', 'Source', 'Subject', 'Sender', 'Received At', 
      'Emergency Score', 'Status', 'Acknowledged By', 'Acknowledged At'
    ];

    const rows = events.map(e => [
      e.id,
      e.source,
      e.subject || '',
      e.senderEmail || e.senderPhone || '',
      e.receivedAt.toISOString(),
      e.emergencyScore?.toString() || '',
      e.status,
      (e as any).acknowledgedBy?.name || '',
      e.acknowledgedAt?.toISOString() || '',
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }
}
