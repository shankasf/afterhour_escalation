/**
 * Escalation Repository Implementation
 * Encapsulates all database operations for escalation logs and contacts.
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EscalationLog, EscalationContact, CallStatus, SmsStatus, ContactType } from '@prisma/client';
import {
  IEscalationRepository,
  CreateEscalationLogDto,
  UpdateEscalationLogDto,
  CreateEscalationContactDto,
  UpdateEscalationContactDto,
} from './escalation.repository.interface';

@Injectable()
export class EscalationRepository implements IEscalationRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ========== Escalation Log Operations ==========

  async createLog(data: CreateEscalationLogDto): Promise<EscalationLog> {
    return this.prisma.escalationLog.create({
      data: {
        eventId: data.eventId,
        contactId: data.contactId,
        userId: data.userId,
        attemptNumber: data.attemptNumber,
        callStatus: CallStatus.not_called,
        smsStatus: SmsStatus.not_sent,
      },
    });
  }

  async updateLog(id: string, data: UpdateEscalationLogDto): Promise<EscalationLog> {
    return this.prisma.escalationLog.update({
      where: { id },
      data: {
        callSid: data.callSid,
        callStatus: data.callStatus,
        smsSid: data.smsSid,
        smsStatus: data.smsStatus,
        acknowledgmentReceived: data.acknowledgmentReceived,
        acknowledgedAt: data.acknowledgedAt,
        errorMessage: data.errorMessage,
      },
    });
  }

  async findLogsByEventId(eventId: string): Promise<EscalationLog[]> {
    return this.prisma.escalationLog.findMany({
      where: { eventId },
      include: {
        user: { select: { id: true, name: true, phoneNumber: true } },
      },
      orderBy: { attemptNumber: 'asc' },
    });
  }

  async findLogByCallSid(callSid: string): Promise<EscalationLog | null> {
    const logs = await this.prisma.escalationLog.findMany({
      where: { callSid },
      include: { event: true },
    });
    return logs[0] || null;
  }

  async findLatestLogByEventId(eventId: string): Promise<EscalationLog | null> {
    return this.prisma.escalationLog.findFirst({
      where: { eventId },
      orderBy: { attemptNumber: 'desc' },
    });
  }

  async updateLogByCallSid(callSid: string, data: UpdateEscalationLogDto): Promise<void> {
    await this.prisma.escalationLog.updateMany({
      where: { callSid },
      data: {
        callStatus: data.callStatus,
        acknowledgmentReceived: data.acknowledgmentReceived,
        acknowledgedAt: data.acknowledgedAt,
      },
    });
  }

  async updateLogBySmsSid(smsSid: string, data: UpdateEscalationLogDto): Promise<void> {
    await this.prisma.escalationLog.updateMany({
      where: { smsSid },
      data: {
        smsStatus: data.smsStatus,
      },
    });
  }

  // ========== Escalation Contact Operations ==========

  async findAllContacts(): Promise<EscalationContact[]> {
    return this.prisma.escalationContact.findMany({
      include: {
        user: { select: { id: true, name: true, email: true, phoneNumber: true } },
      },
      orderBy: [{ contactType: 'asc' }, { position: 'asc' }],
    });
  }

  async findContactById(id: string): Promise<EscalationContact | null> {
    return this.prisma.escalationContact.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, phoneNumber: true } },
      },
    });
  }

  async findContactByUserId(userId: string, contactType?: string): Promise<EscalationContact | null> {
    const where: { userId: string; contactType?: ContactType } = { userId };
    if (contactType) {
      where.contactType = contactType as ContactType;
    }

    return this.prisma.escalationContact.findFirst({
      where,
      include: { user: true },
    });
  }

  async findActiveContactsByType(contactType: string): Promise<EscalationContact[]> {
    return this.prisma.escalationContact.findMany({
      where: {
        contactType: contactType as ContactType,
        isActive: true,
      },
      include: { user: true },
      orderBy: { position: 'asc' },
    });
  }

  async findFixedContacts(): Promise<EscalationContact[]> {
    return this.prisma.escalationContact.findMany({
      where: {
        contactType: ContactType.fixed,
        isActive: true,
      },
      include: { user: true },
      orderBy: { position: 'asc' },
    });
  }

  async createContact(data: CreateEscalationContactDto): Promise<EscalationContact> {
    return this.prisma.escalationContact.create({
      data: {
        userId: data.userId,
        contactType: data.contactType as ContactType,
        position: data.position,
        isActive: data.isActive ?? true,
      },
      include: {
        user: { select: { id: true, name: true, email: true, phoneNumber: true } },
      },
    });
  }

  async updateContact(id: string, data: UpdateEscalationContactDto): Promise<EscalationContact> {
    return this.prisma.escalationContact.update({
      where: { id },
      data,
      include: {
        user: { select: { id: true, name: true, email: true, phoneNumber: true } },
      },
    });
  }

  async deleteContact(id: string): Promise<void> {
    await this.prisma.escalationContact.delete({ where: { id } });
  }

  async deactivateContactsByType(contactTypes: string[]): Promise<void> {
    await this.prisma.escalationContact.updateMany({
      where: {
        contactType: { in: contactTypes as ContactType[] },
      },
      data: { isActive: false },
    });
  }

  async upsertContact(userId: string, contactType: string, position: number): Promise<EscalationContact> {
    return this.prisma.escalationContact.upsert({
      where: {
        userId_contactType: {
          userId,
          contactType: contactType as ContactType,
        },
      },
      update: { isActive: true, position },
      create: {
        userId,
        contactType: contactType as ContactType,
        position,
        isActive: true,
      },
    });
  }
}
