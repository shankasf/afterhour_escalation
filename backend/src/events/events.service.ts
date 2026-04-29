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
            user: { select: { id: true, name: true, phoneNumber: true, email: true } },
            contact: {
              include: {
                user: { select: { id: true, name: true, phoneNumber: true, email: true } },
              },
            },
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
    body?: string;
    rawContent?: string;
    senderEmail: string;
    senderName?: string;
    senderDomain?: string;
    receivedAt?: Date;
    emergencyScore?: number;
    aiSummary?: string;
    extractedContext?: Record<string, any>;
  }): Promise<Event> {
    this.logger.log('='.repeat(60));
    this.logger.log('[EVENTS SERVICE] Creating email event');
    this.logger.log(`  From: ${data.senderEmail}`);
    this.logger.log(`  Subject: ${data.subject?.substring(0, 60)}...`);
    this.logger.log(`  Pre-triaged Score: ${data.emergencyScore ?? 'N/A'}`);

    // Extract domain from email if not provided
    const senderDomain = data.senderDomain || data.senderEmail.split('@')[1] || '';
    const body = data.body || data.rawContent || '';

    // If AI triage already done (from poller), use provided score
    if (data.emergencyScore !== undefined) {
      const event = await this.prisma.event.create({
        data: {
          source: EventSource.email,
          subject: data.subject,
          body: body,
          aiSummary: data.aiSummary,
          senderEmail: data.senderEmail,
          senderDomain: senderDomain,
          receivedAt: data.receivedAt || new Date(),
          status: data.emergencyScore >= 0.6 ? EventStatus.escalated : EventStatus.pending,
          emergencyScore: data.emergencyScore,
          extractedContext: data.extractedContext as any,
        },
      });

      this.logger.log(`[EVENTS SERVICE] Event created successfully`);
      this.logger.log(`  Event ID: ${event.id}`);
      this.logger.log(`  Score: ${data.emergencyScore}`);
      this.logger.log(`  Status: ${event.status}`);
      this.logger.log('='.repeat(60));
      this.wsGateway.emitNewEvent(event);
      return event;
    }

    // Create the event first (legacy path without pre-triage)
    const event = await this.prisma.event.create({
      data: {
        source: EventSource.email,
        subject: data.subject,
        body: body,
        senderEmail: data.senderEmail,
        senderDomain: senderDomain,
        receivedAt: data.receivedAt || new Date(),
        status: EventStatus.pending,
      },
    });

    // Call AI service to classify
    try {
      const classification = await this.aiService.classifyEmail({
        subject: data.subject,
        body: body,
        senderDomain: senderDomain,
      });

      // Update event with classification results
      const updatedEvent = await this.prisma.event.update({
        where: { id: event.id },
        data: {
          emergencyScore: classification.emergencyScore,
          extractedContext: classification.extractedContext as any,
          aiSummary: (classification as any)?.reasoning,
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
          include: {
            user: { select: { id: true, name: true, phoneNumber: true } },
          },
        },
      },
    });
  }

  async getAcknowledgedEvents(ownerId?: string): Promise<Event[]> {
    const where: Prisma.EventWhereInput = {
      status: EventStatus.acknowledged,
    };
    
    if (ownerId) {
      where.acknowledgedById = ownerId;
    }
    
    return this.prisma.event.findMany({
      where,
      orderBy: { acknowledgedAt: 'desc' },
      include: {
        acknowledgedBy: {
          select: { id: true, name: true, email: true },
        },
      },
      take: 10,
    });
  }

  async downgradeEvent(id: string, userId: string, reason: string): Promise<Event> {
    this.logger.log(`Downgrading event ${id} by user ${userId}: ${reason}`);

    // Fetch existing event first to avoid race condition
    const existingEvent = await this.prisma.event.findUnique({ where: { id } });
    if (!existingEvent) {
      throw new Error(`Event ${id} not found`);
    }

    const existingContext = (existingEvent.extractedContext as Record<string, any>) || {};

    const event = await this.prisma.event.update({
      where: { id },
      data: {
        status: EventStatus.downgraded,
        extractedContext: {
          ...existingContext,
          downgradeReason: reason,
          downgradedBy: userId,
          downgradedAt: new Date().toISOString(),
        } as any,
      },
    });

    this.wsGateway.emitEventUpdate(event);
    return event;
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

    // Helper to escape CSV fields (handles commas, quotes, newlines)
    const escapeCsvField = (field: string): string => {
      if (!field) return '';
      // If field contains comma, quote, or newline, wrap in quotes and escape existing quotes
      if (field.includes(',') || field.includes('"') || field.includes('\n') || field.includes('\r')) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    };

    const rows = events.map(e => [
      escapeCsvField(e.id),
      escapeCsvField(e.source),
      escapeCsvField(e.subject || ''),
      escapeCsvField(e.senderEmail || e.senderPhone || ''),
      escapeCsvField(e.receivedAt.toISOString()),
      escapeCsvField(e.emergencyScore?.toString() || ''),
      escapeCsvField(e.status),
      escapeCsvField((e as any).acknowledgedBy?.name || ''),
      escapeCsvField(e.acknowledgedAt?.toISOString() || ''),
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }
}
