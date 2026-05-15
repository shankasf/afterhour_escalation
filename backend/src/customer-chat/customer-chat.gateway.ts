import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatModality, ChatRole } from '@prisma/client';
import { ChatSessionService } from './chat-session.service';

interface CustomerMessagePayload {
  text: string;
  modality?: ChatModality;
  audioUrl?: string;
  durationMs?: number;
}

/**
 * Anonymous WebSocket for the customer-facing chat widget. Auth is by
 * sessionToken (not JWT) — the widget runs unauthenticated on the customer
 * subdomain.
 */
@WebSocketGateway({ namespace: '/customer-chat', cors: true })
export class CustomerChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(CustomerChatGateway.name);
  private readonly socketSessionMap = new Map<string, string>();

  constructor(
    private readonly chatSessions: ChatSessionService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const sessionToken = (client.handshake?.auth as any)?.sessionToken as
      | string
      | undefined;
    if (!sessionToken) {
      this.logger.warn(
        `customer-chat reject socket=${client.id}: no sessionToken`,
      );
      client.disconnect(true);
      return;
    }

    const result = await this.chatSessions.getSession(sessionToken);
    if (!result) {
      this.logger.warn(
        `customer-chat reject socket=${client.id}: unknown session ${sessionToken}`,
      );
      client.disconnect(true);
      return;
    }

    this.socketSessionMap.set(client.id, sessionToken);
    client.join(`chat:${sessionToken}`);
    this.logger.log(
      `customer-chat connect socket=${client.id} session=${sessionToken}`,
    );
  }

  handleDisconnect(client: Socket): void {
    this.socketSessionMap.delete(client.id);
    this.logger.log(`customer-chat disconnect socket=${client.id}`);
  }

  emitToSession(sessionToken: string, event: string, payload: unknown): void {
    if (!this.server) return;
    this.server.to(`chat:${sessionToken}`).emit(event, payload);
  }

  @SubscribeMessage('customer_message')
  async handleCustomerMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CustomerMessagePayload,
  ): Promise<{ ok: true } | { error: string }> {
    const sessionToken = this.socketSessionMap.get(client.id);
    if (!sessionToken) {
      return { error: 'unauthenticated' };
    }
    if (!payload?.text) {
      return { error: 'text required' };
    }

    await this.chatSessions.appendMessage(sessionToken, {
      role: ChatRole.customer,
      text: payload.text,
      modality: payload.modality,
      audioUrl: payload.audioUrl,
      durationMs: payload.durationMs,
    });

    const eventId = await this.chatSessions.ensureEventForSession(
      sessionToken,
      payload.text,
    );
    await this.notifyAiService(sessionToken, payload.text, eventId);
    return { ok: true };
  }

  private async notifyAiService(
    sessionToken: string,
    text: string,
    eventId: string | null,
  ): Promise<void> {
    const aiBase = this.configService.get<string>('AI_SERVICE_URL');
    const internalKey = this.configService.get<string>('INTERNAL_API_KEY');
    if (!aiBase || !internalKey) {
      this.logger.error(
        'notifyAiService: AI_SERVICE_URL or INTERNAL_API_KEY missing',
      );
      return;
    }

    try {
      await firstValueFrom(
        this.httpService.post(
          `${aiBase}/graph/event`,
          {
            event_id: eventId ?? `chat-${sessionToken}`,
            channel_event: {
              kind: 'customer_chat_message',
              session_token: sessionToken,
              text,
            },
          },
          {
            headers: { 'x-internal-key': internalKey },
            timeout: 10000,
          },
        ),
      );
    } catch (err) {
      this.logger.error(
        `notifyAiService failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }
}
