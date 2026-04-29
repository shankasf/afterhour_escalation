import { io, Socket } from 'socket.io-client';
import type { StartParams, StartResponse, TransportEvent, TransportListener, WidgetConfig } from './types';
import { getCorrelationId, logger } from './logger';

const SESSION_KEY = 'ah_chat_session';

export class ChatTransport {
  private socket: Socket | null = null;
  private listeners: Set<TransportListener> = new Set();
  private sessionToken: string | null = null;
  private intentionallyClosed = false;
  private apiBaseUrl: string;
  private wsUrl: string;

  constructor(config: WidgetConfig = {}) {
    this.apiBaseUrl = config.apiBaseUrl ?? 'https://api.amsterdamhostel.cloud';
    this.wsUrl = config.wsUrl ?? 'https://api.amsterdamhostel.cloud/customer-chat';
    const stored = this.readStoredSession();
    if (stored) this.sessionToken = stored;
  }

  on(listener: TransportListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSessionToken(): string | null {
    return this.sessionToken;
  }

  async start(params: StartParams = {}): Promise<string> {
    if (this.sessionToken && this.socket && this.socket.connected) {
      return this.sessionToken;
    }
    if (!this.sessionToken) {
      logger.info('chat.start.request');
      const res = await fetch(`${this.apiBaseUrl}/api/customer-chat/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-correlation-id': getCorrelationId(),
        },
        body: JSON.stringify(params),
      });
      if (!res.ok) {
        logger.error('chat.start.failed', { status: res.status });
        throw new Error(`Failed to start chat: ${res.status}`);
      }
      const data = (await res.json()) as StartResponse;
      this.sessionToken = data.sessionToken;
      this.writeStoredSession(data.sessionToken);
      logger.info('chat.start.ok');
    }
    this.connectWs();
    return this.sessionToken!;
  }

  sendText(text: string): void {
    logger.info('chat.send_text', { length: text.length });
    this.socket?.emit('customer_message', { text });
  }

  sendIce(candidate: RTCIceCandidate): void {
    this.socket?.emit('customer_ice', { candidate: candidate.toJSON() });
  }

  close(): void {
    this.intentionallyClosed = true;
    if (this.socket) {
      logger.info('ws.close');
      this.socket.disconnect();
      this.socket = null;
    }
  }

  reset(): void {
    this.close();
    this.sessionToken = null;
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  }

  private connectWs(): void {
    if (!this.sessionToken) return;
    this.intentionallyClosed = false;
    if (this.socket) this.socket.disconnect();

    const correlationId = getCorrelationId();
    const wsUrlWithCid = this.wsUrl.includes('?')
      ? `${this.wsUrl}&correlationId=${encodeURIComponent(correlationId)}`
      : `${this.wsUrl}?correlationId=${encodeURIComponent(correlationId)}`;

    logger.info('ws.connect.attempt');
    this.socket = io(wsUrlWithCid, {
      transports: ['websocket'],
      auth: { sessionToken: this.sessionToken, correlationId },
      query: { correlationId },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 15000,
    });

    this.socket.on('connect', () => {
      logger.info('ws.open');
      this.emit({ type: 'connected', payload: {} });
    });
    this.socket.on('disconnect', (reason: string) => {
      logger.info('ws.close', { reason });
      this.emit({ type: 'disconnected', payload: {} });
    });
    this.socket.on('connect_error', (err: Error) => {
      logger.error('ws.error', { message: err?.message });
    });
    this.socket.onAny((event: string, data: unknown) => {
      if (event === 'connect' || event === 'disconnect') return;
      this.emit({ type: event, payload: (data ?? {}) as Record<string, unknown> } as TransportEvent);
    });
  }

  private emit(event: TransportEvent): void {
    this.listeners.forEach((l) => {
      try {
        l(event);
      } catch {
        /* ignore listener errors */
      }
    });
  }

  private readStoredSession(): string | null {
    try {
      return localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  }

  private writeStoredSession(token: string): void {
    try {
      localStorage.setItem(SESSION_KEY, token);
    } catch {
      /* ignore */
    }
  }
}
