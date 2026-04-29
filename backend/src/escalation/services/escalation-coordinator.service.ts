/**
 * Escalation Coordinator Service
 * Persists escalation lifecycle (start/cancel/ack). The LangGraph workflow
 * drives outreach, so this service no longer dispatches calls/SMS itself.
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventStatus } from '@prisma/client';
import { WebsocketGateway } from '../../websocket/websocket.gateway';
import { EventRepository } from '../../events/repositories/event.repository';
import { EscalationRepository } from '../repositories/escalation.repository';
import { LadderBuilderService } from './ladder-builder.service';
import { AcknowledgmentHandlerService } from './acknowledgment-handler.service';

@Injectable()
export class EscalationCoordinatorService {
  private readonly logger = new Logger(EscalationCoordinatorService.name);

  constructor(
    private readonly eventRepository: EventRepository,
    private readonly escalationRepository: EscalationRepository,
    private readonly ladderBuilder: LadderBuilderService,
    private readonly ackHandler: AcknowledgmentHandlerService,
    private readonly wsGateway: WebsocketGateway,
  ) {}

  /**
   * Start escalation for an event.
   * Builds and persists the ladder snapshot, marks the event as escalated.
   * The LangGraph workflow takes over from here for actual outreach.
   */
  async startEscalation(eventId: string): Promise<void> {
    this.logger.log({ message: 'Coordinator: starting escalation', eventId });

    const event = await this.eventRepository.findById(eventId);
    if (!event) {
      this.logger.error({
        message: 'Coordinator: cannot start, event not found',
        eventId,
      });
      throw new Error(`Event ${eventId} not found`);
    }

    const ladder = await this.ladderBuilder.buildLadder();

    await this.eventRepository.update(eventId, {
      escalationLadderSnapshot: ladder,
      status: EventStatus.escalated,
    });

    this.logger.log({
      message: 'Coordinator: escalation persisted, awaiting LangGraph workflow',
      eventId,
      ladderSize: ladder.length,
    });

    this.wsGateway.emitEscalationUpdate({
      eventId,
      status: 'escalated',
    });
  }

  /**
   * Handle acknowledgment.
   */
  async handleAcknowledgment(
    eventId: string,
    userId: string,
    method: 'sms' | 'call',
  ): Promise<void> {
    await this.ackHandler.handleAcknowledgment(eventId, userId, method);
  }

  /**
   * Cancel an active escalation. Marks the event as closed; the LangGraph
   * workflow observes the status change and stops dispatching.
   */
  async cancelEscalation(eventId: string): Promise<void> {
    this.logger.log({
      message: 'Coordinator: cancelling escalation',
      eventId,
    });
    await this.eventRepository.updateStatus(eventId, EventStatus.closed);
  }

  /**
   * Get escalation logs for an event.
   */
  async getEscalationLogs(eventId: string) {
    return this.escalationRepository.findLogsByEventId(eventId);
  }
}
