/**
 * Escalation Coordinator Service
 * Coordinates the escalation workflow by delegating to specialized services.
 * This is the main orchestrator following the Single Responsibility Principle.
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventStatus, AlertType } from '@prisma/client';
import { AiServiceClient } from '../../ai-service/ai-service.client';
import { WebsocketGateway } from '../../websocket/websocket.gateway';
import { AlertsService } from '../../alerts/alerts.service';
import { EventRepository } from '../../events/repositories/event.repository';
import { EscalationRepository } from '../repositories/escalation.repository';
import { LadderBuilderService } from './ladder-builder.service';
import { StatusTrackerService } from './status-tracker.service';
import { AcknowledgmentHandlerService } from './acknowledgment-handler.service';
import { EscalationLadderContact } from '../../common/types/event.types';
import { SettingsService } from '../../settings/settings.service';

@Injectable()
export class EscalationCoordinatorService {
  private readonly logger = new Logger(EscalationCoordinatorService.name);
  private activeEscalations = new Map<string, NodeJS.Timeout>();
  private advancingEscalations = new Set<string>();

  constructor(
    private readonly eventRepository: EventRepository,
    private readonly escalationRepository: EscalationRepository,
    private readonly ladderBuilder: LadderBuilderService,
    private readonly statusTracker: StatusTrackerService,
    private readonly ackHandler: AcknowledgmentHandlerService,
    private readonly aiService: AiServiceClient,
    private readonly wsGateway: WebsocketGateway,
    private readonly alertsService: AlertsService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Start escalation for an event.
   */
  async startEscalation(eventId: string): Promise<void> {
    this.logger.log(`Starting escalation for event ${eventId}`);

    const event = await this.eventRepository.findById(eventId);
    if (!event) {
      throw new Error(`Event ${eventId} not found`);
    }

    // Build escalation ladder
    const ladder = await this.ladderBuilder.buildLadder();

    // Save ladder snapshot to event
    await this.eventRepository.update(eventId, {
      escalationLadderSnapshot: ladder,
      status: EventStatus.escalated,
    });

    // Start with first contact
    await this.escalateToContact(eventId, ladder, 0);
  }

  /**
   * Escalate to a specific contact in the ladder.
   */
  async escalateToContact(
    eventId: string,
    ladder: EscalationLadderContact[],
    index: number,
  ): Promise<void> {
    // Prevent concurrent escalation advances
    if (this.advancingEscalations.has(eventId)) {
      this.logger.warn(`Already advancing escalation for event ${eventId}, skipping`);
      return;
    }
    this.advancingEscalations.add(eventId);

    let nextIndex: number | null = null;

    try {
      // Re-check event status
      if (await this.ackHandler.isEventAcknowledged(eventId)) {
        this.logger.log(`Event ${eventId} already acknowledged, stopping escalation`);
        this.activeEscalations.delete(eventId);
        return;
      }

      if (index >= ladder.length) {
        this.logger.error(`All contacts exhausted for event ${eventId}`);
        await this.handleEscalationFailure(eventId);
        return;
      }

      const contact = ladder[index];
      const attemptNumber = index + 1;

      this.logger.log(`Escalating event ${eventId} to ${contact.name} (attempt ${attemptNumber})`);

      // Create escalation log entry
      const escalationLog = await this.escalationRepository.createLog({
        eventId,
        contactId: contact.id,
        userId: contact.userId,
        attemptNumber,
      });

      // Emit websocket update
      this.wsGateway.emitEscalationUpdate({
        eventId,
        contactName: contact.name,
        attemptNumber,
        status: 'calling',
      });

      try {
        const event = await this.eventRepository.findById(eventId);

        // Call AI service to send call and SMS
        const result = await this.aiService.sendEscalation({
          eventId,
          escalationLogId: escalationLog.id,
          contact: {
            name: contact.name,
            phone: contact.phoneNumber,
          },
          event,
        });

        // Update escalation log with call/SMS SIDs
        await this.statusTracker.updateLogAfterSend(
          escalationLog.id,
          result.callSid,
          result.smsSid,
        );

        // Set timeout for acknowledgment
        const timeoutMs = await this.getAckTimeoutMs();
        const timeout = setTimeout(async () => {
          await this.handleAckTimeout(eventId, escalationLog.id, ladder, index);
        }, timeoutMs);

        this.activeEscalations.set(eventId, timeout);
      } catch (error) {
        this.logger.error(`Failed to escalate to ${contact.name}: ${error.message}`);
        await this.statusTracker.markLogFailed(escalationLog.id, error.message);
        nextIndex = index + 1;
      }
    } finally {
      this.advancingEscalations.delete(eventId);
    }

    if (nextIndex !== null) {
      await this.escalateToContact(eventId, ladder, nextIndex);
    }
  }

  /**
   * Handle acknowledgment timeout.
   */
  private async handleAckTimeout(
    eventId: string,
    escalationLogId: string,
    ladder: EscalationLadderContact[],
    currentIndex: number,
  ): Promise<void> {
    this.logger.log(`ACK timeout for event ${eventId}`);

    if (await this.ackHandler.isEventAcknowledged(eventId)) {
      return;
    }

    await this.statusTracker.markLogNoAnswer(escalationLogId);
    await this.escalateToContact(eventId, ladder, currentIndex + 1);
  }

  /**
   * Handle escalation failure when all contacts are exhausted.
   */
  private async handleEscalationFailure(eventId: string): Promise<void> {
    await this.eventRepository.updateStatus(eventId, EventStatus.missed);

    await this.alertsService.create({
      eventId,
      alertType: AlertType.no_acknowledgment,
      message: `Event ${eventId} was not acknowledged by any contact`,
    });

    this.wsGateway.emitEscalationUpdate({
      eventId,
      status: 'missed',
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
    // Clear timeout
    const timeout = this.activeEscalations.get(eventId);
    if (timeout) {
      clearTimeout(timeout);
      this.activeEscalations.delete(eventId);
    }

    await this.ackHandler.handleAcknowledgment(eventId, userId, method);
  }

  /**
   * Cancel an active escalation.
   */
  async cancelEscalation(eventId: string): Promise<void> {
    const timeout = this.activeEscalations.get(eventId);
    if (timeout) {
      clearTimeout(timeout);
      this.activeEscalations.delete(eventId);
    }
  }

  /**
   * Handle call status callback and potentially advance escalation.
   */
  async handleCallStatusCallback(data: {
    callSid: string;
    status: string;
    eventId?: string;
    escalationLogId?: string;
  }): Promise<void> {
    const result = await this.statusTracker.handleCallStatus(data);

    if (result.shouldAdvance && result.eventId && result.ladder && result.nextIndex !== undefined) {
      // Clear any existing timeout
      const timeout = this.activeEscalations.get(result.eventId);
      if (timeout) {
        clearTimeout(timeout);
        this.activeEscalations.delete(result.eventId);
      }

      await this.escalateToContact(result.eventId, result.ladder, result.nextIndex);
    }
  }

  /**
   * Handle SMS status callback.
   */
  async handleSmsStatusCallback(data: {
    smsSid: string;
    status: string;
    eventId?: string;
    escalationLogId?: string;
  }): Promise<void> {
    await this.statusTracker.handleSmsStatus(data);
  }

  private async getAckTimeoutMs(): Promise<number> {
    const setting = await this.settingsService.get('acknowledgment_timeout_seconds');
    return (parseInt(setting || '120', 10)) * 1000;
  }

  /**
   * Get escalation logs for an event.
   */
  async getEscalationLogs(eventId: string) {
    return this.escalationRepository.findLogsByEventId(eventId);
  }
}
