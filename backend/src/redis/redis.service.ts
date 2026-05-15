import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Thin wrapper around an `ioredis` client.
 *
 * Reads `REDIS_URL` from config; if the variable is unset the service runs in
 * a disabled state (`isEnabled() === false`) and all I/O methods are no-ops.
 * Callers should consult `isEnabled()` and fall back to an in-process cache
 * when Redis is not available so local-dev / single-node deploys keep working.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const url = this.configService.get<string>('REDIS_URL');
    if (!url) {
      this.logger.warn('REDIS_URL not set; RedisService disabled');
      return;
    }
    try {
      this.client = new Redis(url, {
        // Keep retries bounded so a missing Redis doesn't block boot.
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: false,
      });
      this.client.on('error', (err) => {
        this.logger.error(`Redis error: ${err.message}`);
      });
      this.logger.log(`Redis connected to ${url}`);
    } catch (err) {
      this.logger.error(
        `Failed to init Redis: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      this.client = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        // ignore - shutting down
      }
      this.client = null;
    }
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  getClient(): Redis | null {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    try {
      return await this.client.get(key);
    } catch (err) {
      this.logger.error(
        `redis.get failed for key=${key}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return null;
    }
  }

  /**
   * Atomically SET if-not-exists with a TTL (in seconds). Returns true when
   * the key was newly created, false when it already existed.
   */
  async setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (!this.client) return false;
    try {
      const res = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
      return res === 'OK';
    } catch (err) {
      this.logger.error(
        `redis.setNxEx failed for key=${key}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return false;
    }
  }

  async setEx(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch (err) {
      this.logger.error(
        `redis.setEx failed for key=${key}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.del(key);
    } catch (err) {
      this.logger.error(
        `redis.del failed for key=${key}: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }
}
