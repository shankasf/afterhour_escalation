/**
 * Escalation Repository Interface
 * Defines the contract for escalation-related data access operations.
 */

import { EscalationLog, EscalationContact, CallStatus, SmsStatus } from '@prisma/client';

export interface CreateEscalationLogDto {
  eventId: string;
  contactId: string;
  userId: string;
  attemptNumber: number;
}

export interface UpdateEscalationLogDto {
  callSid?: string;
  callStatus?: CallStatus;
  smsSid?: string;
  smsStatus?: SmsStatus;
  acknowledgmentReceived?: boolean;
  acknowledgedAt?: Date;
  errorMessage?: string;
}

export interface CreateEscalationContactDto {
  userId: string;
  contactType: 'primary' | 'secondary' | 'fixed';
  position: number;
  isActive?: boolean;
}

export interface UpdateEscalationContactDto {
  position?: number;
  isActive?: boolean;
}

export const ESCALATION_REPOSITORY = Symbol('ESCALATION_REPOSITORY');

export interface IEscalationRepository {
  // Escalation Log operations
  createLog(data: CreateEscalationLogDto): Promise<EscalationLog>;
  updateLog(id: string, data: UpdateEscalationLogDto): Promise<EscalationLog>;
  findLogsByEventId(eventId: string): Promise<EscalationLog[]>;
  findLogByCallSid(callSid: string): Promise<EscalationLog | null>;
  findLatestLogByEventId(eventId: string): Promise<EscalationLog | null>;
  updateLogByCallSid(callSid: string, data: UpdateEscalationLogDto): Promise<void>;
  updateLogBySmsSid(smsSid: string, data: UpdateEscalationLogDto): Promise<void>;

  // Escalation Contact operations
  findAllContacts(): Promise<EscalationContact[]>;
  findContactById(id: string): Promise<EscalationContact | null>;
  findContactByUserId(userId: string, contactType?: string): Promise<EscalationContact | null>;
  findActiveContactsByType(contactType: string): Promise<EscalationContact[]>;
  findFixedContacts(): Promise<EscalationContact[]>;
  createContact(data: CreateEscalationContactDto): Promise<EscalationContact>;
  updateContact(id: string, data: UpdateEscalationContactDto): Promise<EscalationContact>;
  deleteContact(id: string): Promise<void>;
  deactivateContactsByType(contactTypes: string[]): Promise<void>;
  upsertContact(userId: string, contactType: string, position: number): Promise<EscalationContact>;
}
