/**
 * Event Repository Interface
 * Defines the contract for event data access operations.
 */

import { Event, EventSource, EventStatus, Prisma } from '@prisma/client';
import { ExtractedContext, EscalationLadderContact } from '../../common/types/event.types';

export interface EventFilters {
  statuses?: EventStatus[];
  source?: EventSource;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface CreateEmailEventDto {
  subject: string;
  body?: string;
  rawContent?: string;
  senderEmail: string;
  senderName?: string;
  senderDomain?: string;
  receivedAt?: Date;
  emergencyScore?: number;
  aiSummary?: string;
  extractedContext?: ExtractedContext;
}

export interface CreateDialpadEventDto {
  senderPhone: string;
  senderName?: string;
  voicemailTranscription?: string;
  voicemailUrl?: string;
  receivedAt: Date;
  callId?: string;
  state?: string;
  emergencyScore?: number;
  priority?: string;
  triageReasoning?: string;
  issueSummary?: string;
}

export interface UpdateEventDto {
  status?: EventStatus;
  acknowledgedById?: string;
  acknowledgedAt?: Date;
  emergencyScore?: number;
  extractedContext?: ExtractedContext;
  aiSummary?: string;
  escalationLadderSnapshot?: EscalationLadderContact[];
}

export const EVENT_REPOSITORY = Symbol('EVENT_REPOSITORY');

export interface IEventRepository {
  findById(id: string): Promise<Event | null>;
  findByIdWithDetails(id: string): Promise<Event | null>;
  findAll(filters?: EventFilters): Promise<{ events: Event[]; total: number }>;
  findByStatus(status: EventStatus): Promise<Event[]>;
  findActiveEscalations(): Promise<Event[]>;
  findAcknowledgedEvents(ownerId?: string, limit?: number): Promise<Event[]>;

  createEmailEvent(data: CreateEmailEventDto): Promise<Event>;
  createDialpadEvent(data: CreateDialpadEventDto): Promise<Event>;

  update(id: string, data: UpdateEventDto): Promise<Event>;
  updateStatus(id: string, status: EventStatus, userId?: string): Promise<Event>;
  setEscalationLadder(id: string, ladder: EscalationLadderContact[]): Promise<Event>;

  count(where?: Prisma.EventWhereInput): Promise<number>;
}
