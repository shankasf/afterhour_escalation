/**
 * Status Tracker Service
 * Responsible for tracking and updating call/SMS status.
 * Single responsibility: Track escalation communication status.
 */

import { Injectable, Logger } from '@nestjs/common';
import { CallStatus, SmsStatus, EventStatus } from '@prisma/client';
import { EscalationRepository } from '../repositories/escalation.repository';
import { EventRepository } from '../../events/repositories/event.repository';
import { WebsocketGateway } from '../../websocket/websocket.gateway';
import { EscalationLadderContact } from '../../common/types/event.types';

export interface CallStatusCallbackData {
  callSid: string;
  status: string;
  eventId?: string;
  escalationLogId?: string;
}

export interface SmsStatusCallbackData {
  smsSid: string;
  status: string;
  eventId?: string;
  escalationLogId?: string;
}

@Injectable()
export class StatusTrackerService {
  private readonly logger = new Logger(StatusTrackerService.name);

  // Maps Twilio statuses to internal CallStatus enum
  private readonly callStatusMap: Record<string, CallStatus> = {
    queued: CallStatus.not_called,
    ringing: CallStatus.ringing,
    'in-progress': CallStatus.answered,
    completed: CallStatus.answered,
    busy: CallStatus.busy,
    failed: CallStatus.failed,
    'no-answer': CallStatus.no_answer,
    canceled: CallStatus.failed,
  };

  // Maps Twilio SMS statuses to internal SmsStatus enum
  private readonly smsStatusMap: Record<string, SmsStatus> = {
    queued: SmsStatus.sent,
    sent: SmsStatus.sent,
    delivered: SmsStatus.delivered,
    undelivered: SmsStatus.failed,
    failed: SmsStatus.failed,
  };

  // Terminal failure statuses that should trigger escalation advancement
  private readonly failureStatuses: CallStatus[] = [
    CallStatus.busy,
    CallStatus.no_answer,
    CallStatus.failed,
  ];

  constructor(
    private readonly escalationRepository: EscalationRepository,
    private readonly eventRepository: EventRepository,
    private readonly wsGateway: WebsocketGateway,
  ) {}

  /**
   * Handle Twilio call status callback.
   * Returns true if escalation should advance to next contact.
   */
  async handleCallStatus(data: CallStatusCallbackData): Promise<{
    shouldAdvance: boolean;
    eventId?: string;
    nextIndex?: number;
    ladder?: EscalationLadderContact[];
  }> {
    this.logger.log(`Call status callback: ${data.callSid} -> ${data.status}`);

    const callStatus = this.callStatusMap[data.status] || CallStatus.failed;

    // Find the escalation log by call SID
    const log = await this.escalationRepository.findLogByCallSid(data.callSid);

    if (!log) {
      this.logger.warn(`No escalation log found for callSid ${data.callSid}`);
      return { shouldAdvance: false };
    }

    // Update the log status
    await this.escalationRepository.updateLog(log.id, { callStatus });

    // Check if event is already acknowledged
    const event = await this.eventRepository.findById(log.eventId);
    if (event?.status === EventStatus.acknowledged) {
      this.logger.log(`Event ${log.eventId} already acknowledged, ignoring call status`);
      return { shouldAdvance: false };
    }

    // Check if this is a terminal failure status
    if (this.failureStatuses.includes(callStatus)) {
      this.logger.log(`Call failed (${data.status}), should advance escalation for event ${log.eventId}`);

      const ladder = (event?.escalationLadderSnapshot as unknown as EscalationLadderContact[]) || [];
      const nextIndex = log.attemptNumber; // attemptNumber is 1-based, so this is next index

      return {
        shouldAdvance: true,
        eventId: log.eventId,
        nextIndex,
        ladder,
      };
    }

    return { shouldAdvance: false };
  }

  /**
   * Handle Twilio SMS status callback.
   */
  async handleSmsStatus(data: SmsStatusCallbackData): Promise<void> {
    this.logger.log(`SMS status callback: ${data.smsSid} -> ${data.status}`);

    const smsStatus = this.smsStatusMap[data.status] || SmsStatus.failed;

    await this.escalationRepository.updateLogBySmsSid(data.smsSid, { smsStatus });
  }

  /**
   * Update escalation log after successful call/SMS send.
   */
  async updateLogAfterSend(
    logId: string,
    callSid?: string,
    smsSid?: string,
  ): Promise<void> {
    await this.escalationRepository.updateLog(logId, {
      callSid,
      callStatus: callSid ? CallStatus.ringing : undefined,
      smsSid,
      smsStatus: smsSid ? SmsStatus.sent : undefined,
    });
  }

  /**
   * Mark escalation log as failed.
   */
  async markLogFailed(logId: string, errorMessage: string): Promise<void> {
    await this.escalationRepository.updateLog(logId, {
      callStatus: CallStatus.failed,
      smsStatus: SmsStatus.failed,
      errorMessage,
    });
  }

  /**
   * Update log status to no answer (for timeout scenarios).
   */
  async markLogNoAnswer(logId: string): Promise<void> {
    await this.escalationRepository.updateLog(logId, {
      callStatus: CallStatus.no_answer,
    });
  }
}
