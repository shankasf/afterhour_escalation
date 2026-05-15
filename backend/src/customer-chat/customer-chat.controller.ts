import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Logger,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Throttle } from '@nestjs/throttler';
import { firstValueFrom } from 'rxjs';
import { ChatRole, ChatModality } from '@prisma/client';
import { ChatSessionService } from './chat-session.service';
import { CustomerChatGateway } from './customer-chat.gateway';

@ApiTags('customer-chat')
@Throttle({ default: { limit: 30, ttl: 60000 } })
@Controller('customer-chat')
export class CustomerChatController {
  private readonly logger = new Logger(CustomerChatController.name);

  constructor(
    private readonly chatSessions: ChatSessionService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly gateway: CustomerChatGateway,
  ) {}

  @Post('start')
  @ApiOperation({ summary: 'Start an anonymous customer chat session' })
  async start(
    @Body() body: { name?: string; email?: string; phone?: string },
    @Headers('user-agent') userAgent?: string,
    @Ip() ip?: string,
  ): Promise<{ sessionToken: string }> {
    const { sessionToken } = await this.chatSessions.createSession({
      name: body?.name,
      email: body?.email,
      phone: body?.phone,
      ip,
      userAgent,
    });
    return { sessionToken };
  }

  @Post(':sessionToken/message')
  @ApiOperation({ summary: 'Append a message to the session (customer or, with internal key, agent/employee)' })
  async postMessage(
    @Param('sessionToken') sessionToken: string,
    @Headers('x-internal-key') internalKey: string | undefined,
    @Body()
    body: {
      text: string;
      role?: 'customer' | 'agent' | 'employee';
      userId?: string;
      modality?: ChatModality;
      audioUrl?: string;
      durationMs?: number;
    },
  ): Promise<{ ok: true }> {
    const expectedKey = this.configService.get<string>('INTERNAL_API_KEY');
    const isInternal = !!internalKey && !!expectedKey && internalKey === expectedKey;
    const requestedRole = (body.role || '').toLowerCase();
    const roleMap: Record<string, ChatRole> = {
      assistant: ChatRole.agent,
      agent: ChatRole.agent,
      employee: ChatRole.employee,
      customer: ChatRole.customer,
    };
    const role: ChatRole =
      isInternal && roleMap[requestedRole] && roleMap[requestedRole] !== ChatRole.customer
        ? roleMap[requestedRole]
        : ChatRole.customer;

    await this.chatSessions.appendMessage(sessionToken, {
      role,
      userId: role === ChatRole.employee ? body.userId : undefined,
      text: body.text,
      modality: body.modality,
      audioUrl: body.audioUrl,
      durationMs: body.durationMs,
    });

    const wsEvent = role === ChatRole.customer ? 'customer_message_echo' : `${role}_message`;
    this.gateway.emitToSession(sessionToken, wsEvent, {
      text: body.text,
      modality: body.modality,
      audioUrl: body.audioUrl,
      durationMs: body.durationMs,
    });

    if (role === ChatRole.customer) {
      const eventId = await this.chatSessions.ensureEventForSession(
        sessionToken,
        body.text,
      );
      await this.notifyAiService(sessionToken, body.text, eventId);
    }
    return { ok: true };
  }

  @Get(':sessionToken/messages')
  @ApiOperation({ summary: 'List recent messages for a chat session' })
  async listMessages(
    @Param('sessionToken') sessionToken: string,
  ): Promise<any[]> {
    const result = await this.chatSessions.getSession(sessionToken);
    if (!result) {
      throw new NotFoundException(`Chat session not found: ${sessionToken}`);
    }
    return result.messages;
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
