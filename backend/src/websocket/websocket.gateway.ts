import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PresenceService } from '../presence/presence.service';

export interface LiveLogEntry {
  id: string;
  timestamp: Date;
  source: 'backend' | 'ai-service';
  level: 'info' | 'warn' | 'error' | 'debug';
  category: 'event' | 'escalation' | 'call' | 'sms' | 'system' | 'ai';
  message: string;
  details?: Record<string, any>;
}

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5175',
    credentials: true,
  },
})
export class WebsocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebsocketGateway.name);
  private logIdCounter = 0;
  private readonly socketUserMap = new Map<string, string>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly presenceService: PresenceService,
  ) {}

  handleConnection(client: Socket) {
    const token = (client.handshake?.auth as any)?.token as string | undefined;
    if (!token) {
      this.logger.warn(`Rejecting socket ${client.id}: no auth token`);
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify(token);
      const userId = payload?.sub as string;
      if (!userId) {
        client.disconnect(true);
        return;
      }
      this.socketUserMap.set(client.id, userId);
      this.presenceService.addSession(userId, client.id);
      client.join(`user:${userId}`);
      this.logger.log(`Client connected: ${client.id} userId=${userId}`);
      this.emitLog('system', 'info', `Dashboard client connected`, {
        clientId: client.id,
        userId,
      });
    } catch (err) {
      this.logger.warn(
        `Rejecting socket ${client.id}: invalid token (${err instanceof Error ? err.message : 'unknown'})`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const userId = this.socketUserMap.get(client.id);
    if (userId) {
      this.presenceService.removeSession(userId, client.id);
      this.socketUserMap.delete(client.id);
    }
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /**
   * Emit an event to all sockets connected for a specific user.
   */
  emitToUser(userId: string, event: string, payload: any): void {
    this.server.to(`user:${userId}`).emit(event, payload);
  }

  @SubscribeMessage('subscribe')
  handleSubscribe(client: Socket, room: string) {
    client.join(room);
    this.logger.log(`Client ${client.id} joined room: ${room}`);
  }

  @SubscribeMessage('unsubscribe')
  handleUnsubscribe(client: Socket, room: string) {
    client.leave(room);
    this.logger.log(`Client ${client.id} left room: ${room}`);
  }

  // Generate unique log ID
  private generateLogId(): string {
    return `log-${Date.now()}-${++this.logIdCounter}`;
  }

  // Emit a live log entry
  emitLog(
    category: LiveLogEntry['category'],
    level: LiveLogEntry['level'],
    message: string,
    details?: Record<string, any>,
    source: 'backend' | 'ai-service' = 'backend',
  ) {
    const logEntry: LiveLogEntry = {
      id: this.generateLogId(),
      timestamp: new Date(),
      source,
      level,
      category,
      message,
      details,
    };
    this.server.emit('log:new', logEntry);
  }

  // Emit methods for real-time updates
  emitNewEvent(event: any) {
    this.server.emit('event:new', event);
    this.emitLog('event', 'info', `New event received: ${event.subject?.substring(0, 50) || 'No subject'}`, {
      eventId: event.id,
      source: event.source,
      score: event.emergencyScore,
    });
  }

  emitEventUpdate(event: any) {
    this.server.emit('event:update', event);
    this.emitLog('event', 'info', `Event updated: ${event.status}`, {
      eventId: event.id,
      status: event.status,
    });
  }

  emitEscalationUpdate(data: {
    eventId: string;
    contactName?: string;
    attemptNumber?: number;
    status: string;
    callStatus?: string;
    smsStatus?: string;
  }) {
    this.server.emit('escalation:update', data);

    const level = data.status === 'missed' ? 'error' :
                  data.status === 'acknowledged' ? 'info' : 'warn';

    this.emitLog('escalation', level,
      data.contactName
        ? `Escalating to ${data.contactName} (attempt #${data.attemptNumber})`
        : `Escalation ${data.status}`,
      data
    );
  }

  emitCallUpdate(data: {
    eventId: string;
    callSid: string;
    status: string;
    contactName?: string;
    phone?: string;
  }) {
    this.server.emit('call:update', data);

    const level = ['answered', 'completed', 'in-progress'].includes(data.status) ? 'info' :
                  ['busy', 'no-answer', 'failed'].includes(data.status) ? 'error' : 'warn';

    this.emitLog('call', level,
      `Call ${data.status}: ${data.contactName || 'Unknown'} (${data.phone || 'N/A'})`,
      data
    );
  }

  emitSmsUpdate(data: {
    eventId: string;
    smsSid: string;
    status: string;
    contactName?: string;
    phone?: string;
  }) {
    this.server.emit('sms:update', data);

    const level = data.status === 'delivered' ? 'info' :
                  data.status === 'failed' ? 'error' : 'warn';

    this.emitLog('sms', level,
      `SMS ${data.status}: ${data.contactName || 'Unknown'}`,
      data
    );
  }

  emitAcknowledgment(data: {
    eventId: string;
    userId: string;
    method: string;
    userName?: string;
  }) {
    this.server.emit('acknowledgment:received', data);
    this.emitLog('escalation', 'info',
      `Acknowledgment received via ${data.method.toUpperCase()}${data.userName ? ` from ${data.userName}` : ''}`,
      data
    );
  }

  emitAlert(alert: any) {
    this.server.emit('alert:new', alert);
    this.emitLog('system', 'warn', `Alert: ${alert.message}`, alert);
  }

  emitHealthUpdate(health: any) {
    this.server.emit('health:update', health);
  }

  // Emit AI service log (called from AI service via internal endpoint)
  emitAiLog(data: {
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    details?: Record<string, any>;
  }) {
    this.emitLog('ai', data.level, data.message, data.details, 'ai-service');
  }

  // Emit live metrics update
  emitMetricsUpdate(metrics: {
    activeCallsCount: number;
    activeSmsCount: number;
    callsAnswered: number;
    callsFailed: number;
    smsDelivered: number;
    avgResponseTime: number;
  }) {
    this.server.emit('metrics:live', metrics);
  }
}
