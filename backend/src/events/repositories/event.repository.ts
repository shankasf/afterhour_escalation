/**
 * Event Repository Implementation
 * Encapsulates all database operations for events.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Event, EventSource, EventStatus, Prisma } from '@prisma/client';
import {
  IEventRepository,
  EventFilters,
  CreateEmailEventDto,
  UpdateEventDto,
} from './event.repository.interface';
import { EscalationLadderContact } from '../../common/types/event.types';

@Injectable()
export class EventRepository implements IEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Event | null> {
    return this.prisma.event.findUnique({ where: { id } });
  }

  async findByIdWithDetails(id: string): Promise<Event | null> {
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

  async findAll(filters?: EventFilters): Promise<{ events: Event[]; total: number }> {
    const where: Prisma.EventWhereInput = {};

    if (filters?.statuses && filters.statuses.length > 0) {
      where.status = { in: filters.statuses };
    }
    if (filters?.source) {
      where.source = filters.source;
    }
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

  async findByStatus(status: EventStatus): Promise<Event[]> {
    return this.prisma.event.findMany({
      where: { status },
      orderBy: { receivedAt: 'desc' },
    });
  }

  async findActiveEscalations(): Promise<Event[]> {
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

  async findAcknowledgedEvents(ownerId?: string, limit: number = 10): Promise<Event[]> {
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
      take: limit,
    });
  }

  async createEmailEvent(data: CreateEmailEventDto): Promise<Event> {
    const senderDomain = data.senderDomain || data.senderEmail.split('@')[1] || '';
    const body = data.body || data.rawContent || '';

    return this.prisma.event.create({
      data: {
        source: EventSource.email,
        subject: data.subject,
        body: body,
        aiSummary: data.aiSummary,
        senderEmail: data.senderEmail,
        senderDomain: senderDomain,
        receivedAt: data.receivedAt || new Date(),
        status: data.emergencyScore !== undefined && data.emergencyScore >= 0.6
          ? EventStatus.escalated
          : EventStatus.pending,
        emergencyScore: data.emergencyScore,
        extractedContext: data.extractedContext as Prisma.InputJsonValue,
      },
    });
  }

  async update(id: string, data: UpdateEventDto): Promise<Event> {
    const updateData: Prisma.EventUpdateInput = {};

    if (data.status !== undefined) updateData.status = data.status;
    if (data.emergencyScore !== undefined) updateData.emergencyScore = data.emergencyScore;
    if (data.aiSummary !== undefined) updateData.aiSummary = data.aiSummary;
    if (data.extractedContext !== undefined) {
      updateData.extractedContext = data.extractedContext as Prisma.InputJsonValue;
    }
    if (data.escalationLadderSnapshot !== undefined) {
      updateData.escalationLadderSnapshot = data.escalationLadderSnapshot as unknown as Prisma.InputJsonValue;
    }
    if (data.acknowledgedById) {
      updateData.acknowledgedBy = { connect: { id: data.acknowledgedById } };
      updateData.acknowledgedAt = data.acknowledgedAt || new Date();
    }

    return this.prisma.event.update({
      where: { id },
      data: updateData,
    });
  }

  async updateStatus(id: string, status: EventStatus, userId?: string): Promise<Event> {
    const updateData: Prisma.EventUpdateInput = { status };

    if (status === EventStatus.acknowledged && userId) {
      updateData.acknowledgedBy = { connect: { id: userId } };
      updateData.acknowledgedAt = new Date();
    }

    return this.prisma.event.update({
      where: { id },
      data: updateData,
    });
  }

  async setEscalationLadder(id: string, ladder: EscalationLadderContact[]): Promise<Event> {
    return this.prisma.event.update({
      where: { id },
      data: {
        escalationLadderSnapshot: ladder as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async count(where?: Prisma.EventWhereInput): Promise<number> {
    return this.prisma.event.count({ where });
  }
}
