import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { JwtService } from '@nestjs/jwt';
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
import { PresenceService } from '../presence/presence.service';

type CallIntent = 'accepted' | 'declined' | 'deferred' | 'hangup';

// Compute the allowed origin list for the signaling namespace at module load
// time. Mirrors the HTTP allowlist built in `main.ts` so an origin allowed for
// REST is also allowed for the Socket.IO handshake.
function buildAllowedOrigins(): string[] {
  const defaultOrigins = [
    'https://main.amsterdamhostel.cloud',
    'https://customer.amsterdamhostel.cloud',
    'https://admin.amsterdamhostel.cloud',
    'https://technician.amsterdamhostel.cloud',
  ];
  const envOrigins = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const legacy = process.env.FRONTEND_URL || 'http://localhost:5175';
  return Array.from(
    new Set<string>([...defaultOrigins, ...envOrigins, legacy]),
  );
}

const JWT_REVALIDATION_INTERVAL_MS = 5 * 60 * 1000; // 5 min

/**
 * WebRTC signaling gateway. Carries SDP offers/answers, ICE candidates, and
 * call lifecycle events between clients. The server only forwards to ai-service
 * over HTTP — no media passes through here.
 */
@WebSocketGateway({
  namespace: '/signaling',
  cors: {
    origin: buildAllowedOrigins(),
    credentials: true,
  },
})
export class SignalingGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SignalingGateway.name);
  private readonly socketUserMap = new Map<string, string>();
  private readonly revalTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly presence: PresenceService,
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  handleConnection(client: Socket): void {
    const token = (client.handshake?.auth as any)?.token as string | undefined;
    if (!token) {
      this.logger.warn(`signaling reject socket=${client.id}: no token`);
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
      this.presence.addSession(userId, client.id);
      client.join(`user:${userId}`);

      // Cache the token on the socket and re-verify periodically. Chose
      // periodic re-verify (over lazy-on-emit) because incoming_call is
      // dispatched from the controller via room broadcast — there's no
      // per-socket hook to intercept cheaply.
      client.data = client.data || {};
      client.data.token = token;
      const timer = setInterval(() => {
        const t = client.data?.token as string | undefined;
        if (!t) {
          client.disconnect(true);
          return;
        }
        try {
          this.jwtService.verify(t);
        } catch (err) {
          this.logger.warn(
            `signaling token expired socket=${client.id} userId=${userId}: ${
              err instanceof Error ? err.message : 'invalid'
            }`,
          );
          client.disconnect(true);
        }
      }, JWT_REVALIDATION_INTERVAL_MS);
      // `unref` so a hung interval doesn't keep the process alive at shutdown.
      if (typeof (timer as any).unref === 'function') {
        (timer as any).unref();
      }
      this.revalTimers.set(client.id, timer);

      this.logger.log(
        `signaling connect socket=${client.id} userId=${userId}`,
      );
    } catch (err) {
      this.logger.warn(
        `signaling reject socket=${client.id}: ${err instanceof Error ? err.message : 'invalid token'}`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const userId = this.socketUserMap.get(client.id);
    if (userId) {
      this.presence.removeSession(userId, client.id);
      this.socketUserMap.delete(client.id);
    }
    const timer = this.revalTimers.get(client.id);
    if (timer) {
      clearInterval(timer);
      this.revalTimers.delete(client.id);
    }
    this.logger.log(`signaling disconnect socket=${client.id}`);
  }

  @SubscribeMessage('webrtc_offer')
  async handleOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { event_id?: string; sdp: any },
  ): Promise<void> {
    await this.forwardWebrtcSignal(client, 'offer', payload);
  }

  @SubscribeMessage('webrtc_answer')
  async handleAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { event_id?: string; sdp: any },
  ): Promise<void> {
    await this.forwardWebrtcSignal(client, 'answer', payload);
  }

  @SubscribeMessage('ice_candidate')
  async handleIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { event_id?: string; candidate: any },
  ): Promise<void> {
    await this.forwardWebrtcSignal(client, 'candidate', payload);
  }

  @SubscribeMessage('call_accepted')
  async handleCallAccepted(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { event_id?: string },
  ): Promise<void> {
    await this.forwardCallIntent(client, 'accepted', payload);
  }

  @SubscribeMessage('call_declined')
  async handleCallDeclined(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { event_id?: string },
  ): Promise<void> {
    await this.forwardCallIntent(client, 'declined', payload);
  }

  @SubscribeMessage('call_defer')
  async handleCallDefer(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { event_id?: string; defer_minutes?: number },
  ): Promise<void> {
    await this.forwardCallIntent(client, 'deferred', payload);
  }

  @SubscribeMessage('call_hangup')
  async handleCallHangup(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { event_id?: string },
  ): Promise<void> {
    await this.forwardCallIntent(client, 'hangup', payload);
  }

  private async forwardWebrtcSignal(
    client: Socket,
    kind: 'offer' | 'answer' | 'candidate',
    payload: any,
  ): Promise<void> {
    const userId = this.socketUserMap.get(client.id);
    if (!userId) {
      this.logger.warn(`webrtc_${kind}: no userId for socket=${client.id}`);
      return;
    }

    const aiBase = this.configService.get<string>('AI_SERVICE_URL');
    const internalKey = this.configService.get<string>('INTERNAL_API_KEY');
    if (!aiBase || !internalKey) {
      this.logger.error(
        `webrtc_${kind}: AI_SERVICE_URL or INTERNAL_API_KEY missing`,
      );
      return;
    }

    const url = `${aiBase}/webrtc/${encodeURIComponent(userId)}/${kind}`;
    try {
      await firstValueFrom(
        this.httpService.post(
          url,
          { user_id: userId, event_id: payload?.event_id, ...payload },
          {
            headers: { 'x-internal-key': internalKey },
            timeout: 10000,
          },
        ),
      );
    } catch (err) {
      this.logger.error(
        `webrtc_${kind} forward failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  private async forwardCallIntent(
    client: Socket,
    intent: CallIntent,
    payload: { event_id?: string; defer_minutes?: number },
  ): Promise<void> {
    const userId = this.socketUserMap.get(client.id);
    if (!userId) {
      this.logger.warn(`call_${intent}: no userId for socket=${client.id}`);
      return;
    }

    const aiBase = this.configService.get<string>('AI_SERVICE_URL');
    const internalKey = this.configService.get<string>('INTERNAL_API_KEY');
    if (!aiBase || !internalKey) {
      this.logger.error(
        `call_${intent}: AI_SERVICE_URL or INTERNAL_API_KEY missing`,
      );
      return;
    }

    try {
      await firstValueFrom(
        this.httpService.post(
          `${aiBase}/graph/event`,
          {
            event_id: payload?.event_id,
            kind: 'phone_response',
            intent,
            user_id: userId,
            defer_minutes: payload?.defer_minutes,
          },
          {
            headers: { 'x-internal-key': internalKey },
            timeout: 10000,
          },
        ),
      );
    } catch (err) {
      this.logger.error(
        `call_${intent} forward failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }
}
