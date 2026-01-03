/**
 * Acknowledgment Handler Service
 * Responsible for processing acknowledgments from calls and SMS.
 * Single responsibility: Handle event acknowledgments.
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EscalationRepository } from '../repositories/escalation.repository';
import { EventRepository } from '../../events/repositories/event.repository';
import { WebsocketGateway } from '../../websocket/websocket.gateway';

export type AckMethod = 'sms' | 'call';

@Injectable()
export class AcknowledgmentHandlerService {
  private readonly logger = new Logger(AcknowledgmentHandlerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly escalationRepository: EscalationRepository,
    private readonly eventRepository: EventRepository,
    private readonly wsGateway: WebsocketGateway,
  ) {}

  /**
   * Process an acknowledgment for an event.
   * Returns the timeout key if one should be cancelled.
   */
  async handleAcknowledgment(
    eventId: string,
    userId: string,
    method: AckMethod,
  ): Promise<void> {
    this.logger.log(`Acknowledgment received for event ${eventId} via ${method}`);

    // Update event status
    await this.eventRepository.update(eventId, {
      status: EventStatus.acknowledged,
      acknowledgedById: userId,
      acknowledgedAt: new Date(),
    });

    // Update latest escalation log
    const latestLog = await this.escalationRepository.findLatestLogByEventId(eventId);

    if (latestLog) {
      await this.escalationRepository.updateLog(latestLog.id, {
        acknowledgmentReceived: true,
        acknowledgedAt: new Date(),
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

    // Emit websocket notification
    this.wsGateway.emitAcknowledgment({
      eventId,
      userId,
      method,
    });
  }

  /**
   * Check if an event is already acknowledged.
   */
  async isEventAcknowledged(eventId: string): Promise<boolean> {
    const event = await this.eventRepository.findById(eventId);
    return event?.status === EventStatus.acknowledged;
  }
}
