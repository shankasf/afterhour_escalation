import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RotationService } from '../rotation/rotation.service';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { AlertsService } from '../alerts/alerts.service';
import {
  EscalationLog,
  EventStatus,
} from '@prisma/client';

interface EscalationContact {
  id: string;
  userId: string;
  name: string;
  phoneNumber: string;
  position: number;
  contactType: string;
}

@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);

  constructor(
    private prisma: PrismaService,
    private rotationService: RotationService,
    private wsGateway: WebsocketGateway,
    private alertsService: AlertsService,
  ) {}

  /**
   * Start escalation for an event.
   * Persists the ladder snapshot and marks the event as escalated.
   * The LangGraph workflow drives outreach and acknowledgment timing.
   */
  async startEscalation(eventId: string): Promise<void> {
    this.logger.log({ message: 'Starting escalation', eventId });

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      this.logger.error({
        message: 'Cannot start escalation: event not found',
        eventId,
      });
      throw new Error(`Event ${eventId} not found`);
    }

    const ladder = await this.buildEscalationLadder();

    if (ladder.length === 0) {
      this.logger.error({
        message: 'No escalation contacts configured for event',
        eventId,
      });
    }

    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        escalationLadderSnapshot: ladder as any,
        status: EventStatus.escalated,
      },
    });

    this.logger.log({
      message: 'Escalation advanced to escalated status',
      eventId,
      ladderSize: ladder.length,
    });

    this.wsGateway.emitEscalationUpdate({
      eventId,
      status: 'escalated',
    });
  }

  async buildEscalationLadder(): Promise<EscalationContact[]> {
    const ladder: EscalationContact[] = [];

    const rotation = await this.rotationService.getCurrentRotation();

    if (rotation) {
      const primaryContact = await this.prisma.escalationContact.findFirst({
        where: { userId: rotation.primaryUserId, isActive: true },
        include: { user: true },
      });

      if (primaryContact && primaryContact.user.phoneNumber) {
        ladder.push({
          id: primaryContact.id,
          userId: primaryContact.userId,
          name: primaryContact.user.name,
          phoneNumber: primaryContact.user.phoneNumber,
          position: 1,
          contactType: 'primary',
        });
      } else if (primaryContact) {
        this.logger.warn(`Primary contact ${primaryContact.user.name} has no phone number - skipping`);
      }

      if (rotation.secondaryUserId) {
        const secondaryContact = await this.prisma.escalationContact.findFirst({
          where: { userId: rotation.secondaryUserId, isActive: true },
          include: { user: true },
        });

        if (secondaryContact && secondaryContact.user.phoneNumber) {
          ladder.push({
            id: secondaryContact.id,
            userId: secondaryContact.userId,
            name: secondaryContact.user.name,
            phoneNumber: secondaryContact.user.phoneNumber,
            position: 2,
            contactType: 'secondary',
          });
        } else if (secondaryContact) {
          this.logger.warn(`Secondary contact ${secondaryContact.user.name} has no phone number - skipping`);
        }
      }
    }

    const fixedContacts = await this.prisma.escalationContact.findMany({
      where: { contactType: 'fixed', isActive: true },
      include: { user: true },
      orderBy: { position: 'asc' },
    });

    for (const contact of fixedContacts) {
      if (contact.user.phoneNumber) {
        ladder.push({
          id: contact.id,
          userId: contact.userId,
          name: contact.user.name,
          phoneNumber: contact.user.phoneNumber,
          position: contact.position,
          contactType: 'fixed',
        });
      } else {
        this.logger.warn(`Fixed contact ${contact.user.name} has no phone number - skipping`);
      }
    }

    return ladder;
  }

  async handleAcknowledgment(
    eventId: string,
    userId: string,
    method: 'sms' | 'call',
  ): Promise<void> {
    this.logger.log({
      message: 'Escalation acknowledgment received (resolve)',
      eventId,
      userId,
      method,
    });

    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        status: EventStatus.acknowledged,
        acknowledgedById: userId,
        acknowledgedAt: new Date(),
      },
    });

    const latestLog = await this.prisma.escalationLog.findFirst({
      where: { eventId },
      orderBy: { attemptNumber: 'desc' },
    });

    if (latestLog) {
      await this.prisma.escalationLog.update({
        where: { id: latestLog.id },
        data: {
          acknowledgmentReceived: true,
          acknowledgedAt: new Date(),
        },
      });
    }

    await this.prisma.acknowledgment.create({
      data: {
        eventId,
        userId,
        method: method as any,
        acknowledgedAt: new Date(),
      },
    });

    this.wsGateway.emitAcknowledgment({
      eventId,
      userId,
      method,
    });
  }

  /**
   * Cancel an active escalation. The LangGraph workflow observes the event
   * status and stops dispatching when the event is no longer in `escalated`.
   */
  async cancelEscalation(eventId: string): Promise<void> {
    this.logger.log({
      message: 'Resolving escalation (cancel)',
      eventId,
    });
    await this.prisma.event.update({
      where: { id: eventId },
      data: { status: EventStatus.closed },
    });
  }

  async getEscalationLogs(eventId: string): Promise<EscalationLog[]> {
    return this.prisma.escalationLog.findMany({
      where: { eventId },
      include: {
        user: { select: { id: true, name: true, phoneNumber: true } },
      },
      orderBy: { attemptNumber: 'asc' },
    });
  }

  async getEscalationContacts(): Promise<any[]> {
    return this.prisma.escalationContact.findMany({
      include: {
        user: { select: { id: true, name: true, email: true, phoneNumber: true } },
      },
      orderBy: [{ contactType: 'asc' }, { position: 'asc' }],
    });
  }

  async createEscalationContact(data: {
    userId: string;
    contactType: string;
    position: number;
  }): Promise<any> {
    return this.prisma.escalationContact.create({
      data: {
        userId: data.userId,
        contactType: data.contactType as any,
        position: data.position,
        isActive: true,
      },
      include: {
        user: { select: { id: true, name: true, email: true, phoneNumber: true } },
      },
    });
  }

  async updateEscalationContact(
    id: string,
    data: { position?: number; isActive?: boolean },
  ): Promise<any> {
    return this.prisma.escalationContact.update({
      where: { id },
      data,
      include: {
        user: { select: { id: true, name: true, email: true, phoneNumber: true } },
      },
    });
  }

  async deleteEscalationContact(id: string): Promise<void> {
    await this.prisma.escalationContact.delete({ where: { id } });
  }

  /**
   * Get all currently-escalating events with their latest contact attempt.
   * Reads from the database; the LangGraph workflow is the source of truth.
   */
  async getActiveEscalations(): Promise<any[]> {
    const escalatingEvents = await this.prisma.event.findMany({
      where: { status: EventStatus.escalated },
      include: {
        escalationLogs: {
          include: {
            user: { select: { id: true, name: true, phoneNumber: true } },
          },
          orderBy: { attemptNumber: 'desc' },
          take: 5,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return escalatingEvents.map((event) => {
      const latestLog = event.escalationLogs[0];
      const ladder = (event.escalationLadderSnapshot as any[]) || [];

      return {
        eventId: event.id,
        subject: event.subject,
        source: event.source,
        emergencyScore: event.emergencyScore,
        status: event.status,
        createdAt: event.createdAt,
        currentContact: latestLog
          ? {
              name: latestLog.user?.name || 'Unknown',
              phone: latestLog.user?.phoneNumber || 'N/A',
              attemptNumber: latestLog.attemptNumber,
            }
          : null,
        totalContacts: ladder.length,
        escalationLogs: event.escalationLogs.map((log) => ({
          id: log.id,
          attemptNumber: log.attemptNumber,
          contactName: log.user?.name || 'Unknown',
          acknowledgmentReceived: log.acknowledgmentReceived,
          createdAt: log.createdAt,
        })),
      };
    });
  }

  async getActiveEscalationCount(): Promise<number> {
    return this.prisma.event.count({
      where: { status: EventStatus.escalated },
    });
  }
}
