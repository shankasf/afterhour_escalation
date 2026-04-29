import { Injectable, Logger } from '@nestjs/common';

/**
 * Tracks which users are currently connected via the signaling/customer-chat
 * gateways. Backed by an in-memory Map<userId, Set<socketId>>.
 *
 * NOTE: This is single-instance only. If we ever scale the backend
 * horizontally we'll need to back this with Redis pub/sub.
 */
@Injectable()
export class PresenceService {
  private readonly logger = new Logger(PresenceService.name);
  private readonly sessions = new Map<string, Set<string>>();

  addSession(userId: string, socketId: string): void {
    let set = this.sessions.get(userId);
    if (!set) {
      set = new Set<string>();
      this.sessions.set(userId, set);
    }
    set.add(socketId);
  }

  removeSession(userId: string, socketId: string): void {
    const set = this.sessions.get(userId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) {
      this.sessions.delete(userId);
    }
  }

  getSockets(userId: string): string[] {
    const set = this.sessions.get(userId);
    return set ? Array.from(set) : [];
  }

  isOnline(userId: string): boolean {
    const set = this.sessions.get(userId);
    return !!set && set.size > 0;
  }

  onlineCount(): number {
    return this.sessions.size;
  }
}
