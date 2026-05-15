import { randomUUID } from 'crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ChatModality,
  ChatRole,
  ChatSessionStatus,
  EventSource,
  EventStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface CreateSessionInput {
  name?: string;
  email?: string;
  phone?: string;
  ip?: string;
  userAgent?: string;
}

interface AppendMessageInput {
  role: ChatRole;
  text: string;
  modality?: ChatModality;
  audioUrl?: string;
  durationMs?: number;
  userId?: string;
}

/**
 * Persistence layer for anonymous customer chat sessions, backed by the
 * Prisma ChatSession / ChatMessage tables.
 */
@Injectable()
export class ChatSessionService {
  private readonly logger = new Logger(ChatSessionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createSession(input: CreateSessionInput): Promise<{
    sessionToken: string;
    id: string;
  }> {
    const sessionToken = randomUUID();
    const session = await this.prisma.chatSession.create({
      data: {
        sessionToken,
        customerName: input.name,
        customerEmail: input.email,
        customerPhone: input.phone,
        ip: input.ip,
        userAgent: input.userAgent,
        status: ChatSessionStatus.active,
      },
    });
    this.logger.log(`createSession token=${sessionToken} id=${session.id}`);
    return { sessionToken, id: session.id };
  }

  async getSession(sessionToken: string): Promise<{
    session: any;
    messages: any[];
  } | null> {
    const session = await this.prisma.chatSession.findUnique({
      where: { sessionToken },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!session) return null;

    // Return messages in chronological order
    const messages = [...session.messages].reverse();
    return { session, messages };
  }

  async appendMessage(
    sessionToken: string,
    input: AppendMessageInput,
  ): Promise<any> {
    const session = await this.prisma.chatSession.findUnique({
      where: { sessionToken },
      select: { id: true },
    });
    if (!session) {
      throw new NotFoundException(`Chat session not found: ${sessionToken}`);
    }

    const [message] = await this.prisma.$transaction([
      this.prisma.chatMessage.create({
        data: {
          sessionId: session.id,
          role: input.role,
          text: input.text,
          modality: input.modality ?? ChatModality.text,
          audioUrl: input.audioUrl,
          durationMs: input.durationMs,
          userId: input.userId,
        },
      }),
      this.prisma.chatSession.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      }),
    ]);

    return message;
  }

  async markConverted(sessionToken: string, eventId: string): Promise<void> {
    await this.prisma.chatSession.update({
      where: { sessionToken },
      data: {
        eventId,
        status: ChatSessionStatus.converted,
      },
    });
    this.logger.log(`markConverted token=${sessionToken} event=${eventId}`);
  }

  /**
   * Ensure an Event row exists for this chat session, creating one on first
   * customer message. Returns the Event id so callers can pass it to the AI
   * service in place of the legacy `chat-<sessionToken>` placeholder.
   *
   * Idempotent: returns the existing event id if the session is already
   * linked.
   */
  async ensureEventForSession(
    sessionToken: string,
    firstMessage: string,
  ): Promise<string | null> {
    const session = await this.prisma.chatSession.findUnique({
      where: { sessionToken },
      select: {
        id: true,
        eventId: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        startedAt: true,
      },
    });
    if (!session) return null;
    if (session.eventId) return session.eventId;

    const trimmed = (firstMessage || '').trim();
    if (!trimmed) return null;

    const senderLabel = session.customerName || session.customerEmail || 'anonymous';
    const subject = `Chat from ${senderLabel}`.slice(0, 500);

    const event = await this.prisma.event.create({
      data: {
        source: EventSource.chat,
        subject,
        body: trimmed,
        senderEmail: session.customerEmail || undefined,
        senderPhone: session.customerPhone || undefined,
        receivedAt: session.startedAt,
        status: EventStatus.pending,
      },
    });

    await this.prisma.chatSession.update({
      where: { id: session.id },
      data: {
        eventId: event.id,
        status: ChatSessionStatus.converted,
      },
    });

    this.logger.log(
      `ensureEventForSession token=${sessionToken} event=${event.id}`,
    );
    return event.id;
  }
}
