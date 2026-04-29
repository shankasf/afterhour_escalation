import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AckMethod, EventStatus } from '@prisma/client';
import { WebsocketGateway } from '../websocket/websocket.gateway';

@Injectable()
export class AcknowledgmentService {
  private readonly logger = new Logger(AcknowledgmentService.name);

  constructor(
    private prisma: PrismaService,
    private wsGateway: WebsocketGateway,
  ) {}

  async cancelAcknowledgment(eventId: string) {
    this.logger.log({ message: 'Cancelling acknowledgment', eventId });

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
    if (!event) {
      throw new NotFoundException(`Event not found: ${eventId}`);
    }

    // Audit trail: keep the Acknowledgment row, only flip the Event back.
    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: {
        status: EventStatus.escalated,
        acknowledgedById: null,
        acknowledgedAt: null,
      },
    });

    this.wsGateway.emitEventUpdate(updated);
    return updated;
  }

  async createAcknowledgment(data: {
    eventId: string;
    userId: string;
    method: AckMethod;
    notes?: string;
    downgradeReason?: string;
  }) {
    this.logger.log({
      message: 'Creating acknowledgment',
      eventId: data.eventId,
      userId: data.userId,
      method: data.method,
      isDowngrade: !!data.downgradeReason,
    });

    // Create acknowledgment record
    const ack = await this.prisma.acknowledgment.create({
      data: {
        eventId: data.eventId,
        userId: data.userId,
        method: data.method,
        acknowledgedAt: new Date(),
        notes: data.notes,
        downgradeReason: data.downgradeReason,
      },
    });

    // Update event status
    const eventStatus = data.downgradeReason 
      ? EventStatus.downgraded 
      : EventStatus.acknowledged;

    await this.prisma.event.update({
      where: { id: data.eventId },
      data: {
        status: eventStatus,
        acknowledgedById: data.userId,
        acknowledgedAt: new Date(),
        downgradeToNonEmergency: !!data.downgradeReason,
      },
    });

    this.logger.log({
      message: 'Acknowledgment recorded and event status updated',
      eventId: data.eventId,
      userId: data.userId,
      status: eventStatus,
    });

    return ack;
  }

  async getAcknowledgments(eventId: string) {
    return this.prisma.acknowledgment.findMany({
      where: { eventId },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { acknowledgedAt: 'desc' },
    });
  }

  async downgradeEvent(eventId: string, userId: string, reason: string) {
    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        status: EventStatus.downgraded,
        downgradeToNonEmergency: true,
      },
    });

    return this.prisma.acknowledgment.create({
      data: {
        eventId,
        userId,
        method: AckMethod.sms,
        acknowledgedAt: new Date(),
        downgradeReason: reason,
      },
    });
  }

  async createAcknowledgmentByPhone(data: {
    eventId: string;
    userId?: string;
    phoneNumber?: string;
    method: AckMethod;
    notes?: string;
  }) {
    this.logger.log({
      message: 'Acknowledgment flow: by phone',
      eventId: data.eventId,
      method: data.method,
    });

    let userId = data.userId;

    // If no userId but phoneNumber provided, find user by phone
    if (!userId && data.phoneNumber) {
      const user = await this.prisma.user.findFirst({
        where: { phoneNumber: data.phoneNumber },
      });
      if (user) {
        userId = user.id;
      }
    }

    // If we still don't have a user, find from active escalation logs
    if (!userId) {
      const event = await this.prisma.event.findUnique({
        where: { id: data.eventId },
        include: {
          escalationLogs: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { user: true },
          },
        },
      });
      if (event?.escalationLogs?.[0]?.userId) {
        userId = event.escalationLogs[0].userId;
      }
    }

    if (!userId) {
      throw new Error('Could not determine user for acknowledgment');
    }

    return this.createAcknowledgment({
      eventId: data.eventId,
      userId,
      method: data.method,
      notes: data.notes,
    });
  }

  /**
   * Create acknowledgment using contact name (for AI service integration).
   * This method accepts the format sent by the AI service.
   */
  async createAcknowledgmentByName(data: {
    eventId: string;
    acknowledgedBy: string;
    method: string;
    timestamp?: string;
  }) {
    this.logger.log({
      message: 'Acknowledgment flow: by name',
      eventId: data.eventId,
      acknowledgedBy: data.acknowledgedBy,
      method: data.method,
    });

    // Find user by name
    const user = await this.prisma.user.findFirst({
      where: { name: data.acknowledgedBy },
    });

    let userId: string;

    if (user) {
      userId = user.id;
    } else {
      // Try to find from active escalation logs
      const event = await this.prisma.event.findUnique({
        where: { id: data.eventId },
        include: {
          escalationLogs: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: { user: true },
          },
        },
      });

      if (event?.escalationLogs?.[0]?.userId) {
        userId = event.escalationLogs[0].userId;
      } else {
        throw new Error(`Could not find user for acknowledgment: ${data.acknowledgedBy}`);
      }
    }

    // Map method string to AckMethod enum
    const method = data.method === 'call_keypress' || data.method === 'call'
      ? AckMethod.call
      : AckMethod.sms;

    const ack = await this.createAcknowledgment({
      eventId: data.eventId,
      userId,
      method,
      notes: `Acknowledged by ${data.acknowledgedBy} via ${data.method}`,
    });

    return {
      success: true,
      acknowledgedAt: ack.acknowledgedAt.toISOString(),
      owner: data.acknowledgedBy,
    };
  }
}
