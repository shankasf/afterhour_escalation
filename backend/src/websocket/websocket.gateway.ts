import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

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

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
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

  // Emit methods for real-time updates
  emitNewEvent(event: any) {
    this.server.emit('event:new', event);
  }

  emitEventUpdate(event: any) {
    this.server.emit('event:update', event);
  }

  emitEscalationUpdate(data: {
    eventId: string;
    contactName?: string;
    attemptNumber?: number;
    status: string;
  }) {
    this.server.emit('escalation:update', data);
  }

  emitAcknowledgment(data: {
    eventId: string;
    userId: string;
    method: string;
  }) {
    this.server.emit('acknowledgment:received', data);
  }

  emitAlert(alert: any) {
    this.server.emit('alert:new', alert);
  }

  emitHealthUpdate(health: any) {
    this.server.emit('health:update', health);
  }
}
