import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RotationService } from '../rotation/rotation.service';
import { AiServiceClient } from '../ai-service/ai-service.client';
import { WebsocketGateway } from '../websocket/websocket.gateway';
import { AlertsService } from '../alerts/alerts.service';
import { 
  Event, EscalationLog, CallStatus, SmsStatus, 
  EventStatus, AlertType 
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
  private activeEscalations = new Map<string, NodeJS.Timeout>();

  constructor(
    private prisma: PrismaService,
    private rotationService: RotationService,
    private aiService: AiServiceClient,
    private wsGateway: WebsocketGateway,
    private alertsService: AlertsService,
  ) {}

  async startEscalation(eventId: string): Promise<void> {
    this.logger.log(`Starting escalation for event ${eventId}`);

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new Error(`Event ${eventId} not found`);
    }

    // Build escalation ladder
    const ladder = await this.buildEscalationLadder();
    
    // Save ladder snapshot to event
    await this.prisma.event.update({
      where: { id: eventId },
      data: { 
        escalationLadderSnapshot: ladder as any,
        status: EventStatus.escalated,
      },
    });

    // Start with first contact
    await this.escalateToContact(eventId, ladder, 0);
  }

  async buildEscalationLadder(): Promise<EscalationContact[]> {
    const ladder: EscalationContact[] = [];

    // Get current rotation
    const rotation = await this.rotationService.getCurrentRotation();
    
    if (rotation) {
      // Add primary on-call
      const primaryContact = await this.prisma.escalationContact.findFirst({
        where: { userId: rotation.primaryUserId, isActive: true },
        include: { user: true },
      });
      
      if (primaryContact) {
        ladder.push({
          id: primaryContact.id,
          userId: primaryContact.userId,
          name: primaryContact.user.name,
          phoneNumber: primaryContact.user.phoneNumber || '',
          position: 1,
          contactType: 'primary',
        });
      }

      // Add secondary on-call
      const secondaryContact = await this.prisma.escalationContact.findFirst({
        where: { userId: rotation.secondaryUserId, isActive: true },
        include: { user: true },
      });
      
      if (secondaryContact) {
        ladder.push({
          id: secondaryContact.id,
          userId: secondaryContact.userId,
          name: secondaryContact.user.name,
          phoneNumber: secondaryContact.user.phoneNumber || '',
          position: 2,
          contactType: 'secondary',
        });
      }
    }

    // Add fixed contacts
    const fixedContacts = await this.prisma.escalationContact.findMany({
      where: { contactType: 'fixed', isActive: true },
      include: { user: true },
      orderBy: { position: 'asc' },
    });

    for (const contact of fixedContacts) {
      ladder.push({
        id: contact.id,
        userId: contact.userId,
        name: contact.user.name,
        phoneNumber: contact.user.phoneNumber || '',
        position: contact.position,
        contactType: 'fixed',
      });
    }

    return ladder;
  }

  private async escalateToContact(
    eventId: string,
    ladder: EscalationContact[],
    index: number,
  ): Promise<void> {
    if (index >= ladder.length) {
      // All contacts exhausted
      this.logger.error(`All contacts exhausted for event ${eventId}`);
      await this.handleEscalationFailure(eventId);
      return;
    }

    const contact = ladder[index];
    const attemptNumber = index + 1;

    this.logger.log(`Escalating event ${eventId} to ${contact.name} (attempt ${attemptNumber})`);

    // Create escalation log entry
    const escalationLog = await this.prisma.escalationLog.create({
      data: {
        eventId,
        contactId: contact.id,
        userId: contact.userId,
        attemptNumber,
        callStatus: CallStatus.not_called,
        smsStatus: SmsStatus.not_sent,
      },
    });

    // Emit websocket update
    this.wsGateway.emitEscalationUpdate({
      eventId,
      contactName: contact.name,
      attemptNumber,
      status: 'calling',
    });

    try {
      // Call AI service to send call and SMS simultaneously
      const result = await this.aiService.sendEscalation({
        eventId,
        escalationLogId: escalationLog.id,
        contact: {
          name: contact.name,
          phone: contact.phoneNumber,
        },
        event: await this.prisma.event.findUnique({ where: { id: eventId } }),
      });

      // Update escalation log with call/SMS SIDs
      await this.prisma.escalationLog.update({
        where: { id: escalationLog.id },
        data: {
          callSid: result.callSid,
          callStatus: CallStatus.ringing,
          smsSid: result.smsSid,
          smsStatus: SmsStatus.sent,
        },
      });

      // Set timeout for acknowledgment
      const timeoutMs = await this.getAckTimeoutMs();
      const timeout = setTimeout(async () => {
        await this.handleAckTimeout(eventId, escalationLog.id, ladder, index);
      }, timeoutMs);

      this.activeEscalations.set(eventId, timeout);

    } catch (error) {
      this.logger.error(`Failed to escalate to ${contact.name}: ${error.message}`);
      
      await this.prisma.escalationLog.update({
        where: { id: escalationLog.id },
        data: {
          callStatus: CallStatus.failed,
          smsStatus: SmsStatus.failed,
          errorMessage: error.message,
        },
      });

      // Move to next contact
      await this.escalateToContact(eventId, ladder, index + 1);
    }
  }

  private async handleAckTimeout(
    eventId: string,
    escalationLogId: string,
    ladder: EscalationContact[],
    currentIndex: number,
  ): Promise<void> {
    this.logger.log(`ACK timeout for event ${eventId}`);

    // Check if already acknowledged
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (event?.status === EventStatus.acknowledged) {
      return; // Already acknowledged
    }

    // Update log
    await this.prisma.escalationLog.update({
      where: { id: escalationLogId },
      data: { callStatus: CallStatus.no_answer },
    });

    // Move to next contact
    await this.escalateToContact(eventId, ladder, currentIndex + 1);
  }

  private async handleEscalationFailure(eventId: string): Promise<void> {
    // Update event status to missed
    await this.prisma.event.update({
      where: { id: eventId },
      data: { status: EventStatus.missed },
    });

    // Create admin alert
    await this.alertsService.create({
      eventId,
      alertType: AlertType.no_acknowledgment,
      message: `Event ${eventId} was not acknowledged by any contact`,
    });

    // Emit websocket
    this.wsGateway.emitEscalationUpdate({
      eventId,
      status: 'missed',
    });
  }

  async handleAcknowledgment(
    eventId: string,
    userId: string,
    method: 'sms' | 'call',
  ): Promise<void> {
    this.logger.log(`Acknowledgment received for event ${eventId} via ${method}`);

    // Clear timeout
    const timeout = this.activeEscalations.get(eventId);
    if (timeout) {
      clearTimeout(timeout);
      this.activeEscalations.delete(eventId);
    }

    // Update event
    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        status: EventStatus.acknowledged,
        acknowledgedById: userId,
        acknowledgedAt: new Date(),
      },
    });

    // Update latest escalation log
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

    // Create acknowledgment record
    await this.prisma.acknowledgment.create({
      data: {
        eventId,
        userId,
        method,
        acknowledgedAt: new Date(),
      },
    });

    // Emit websocket
    this.wsGateway.emitAcknowledgment({
      eventId,
      userId,
      method,
    });
  }

  async cancelEscalation(eventId: string): Promise<void> {
    const timeout = this.activeEscalations.get(eventId);
    if (timeout) {
      clearTimeout(timeout);
      this.activeEscalations.delete(eventId);
    }
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

  private async getAckTimeoutMs(): Promise<number> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'acknowledgment_timeout_seconds' },
    });
    return (parseInt(setting?.value || '120', 10)) * 1000;
  }

  async updateCallStatus(callSid: string, status: CallStatus): Promise<void> {
    await this.prisma.escalationLog.updateMany({
      where: { callSid },
      data: { callStatus: status },
    });
  }

  async updateSmsStatus(smsSid: string, status: SmsStatus): Promise<void> {
    await this.prisma.escalationLog.updateMany({
      where: { smsSid },
      data: { smsStatus: status },
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
}
