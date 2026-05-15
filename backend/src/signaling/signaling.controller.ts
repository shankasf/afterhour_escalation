import {
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { SignalingGateway } from './signaling.gateway';
import { PresenceService } from '../presence/presence.service';
import { PushService } from '../push/push.service';
import { RedisService } from '../redis/redis.service';
import { DispatchBodyDto } from './dto/dispatch.dto';
import { getCorrelationId } from '../common/logging/correlation-id.context';

type DispatchOutcome = 'socket' | 'push';

interface DispatchResponse {
  delivered: DispatchOutcome;
}

interface IdempotencyRecord {
  payloadHash: string;
  status: number;
  body: unknown;
}

const IDEMPOTENCY_TTL_SECONDS = 60;

// Fallback in-process idempotency cache used when Redis is not configured.
// Keyed by `event_id|user_id`. Single-instance only; with multi-instance
// deployments Redis must be enabled to guarantee correctness.
const memoryIdempotency = new Map<
  string,
  { record: IdempotencyRecord; expiresAt: number }
>();

@ApiTags('signaling')
@Controller('signaling')
export class SignalingController {
  private readonly logger = new Logger(SignalingController.name);
  private readonly internalKeyBuf: Buffer;

  constructor(
    private readonly gateway: SignalingGateway,
    private readonly presence: PresenceService,
    private readonly pushService: PushService,
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
  ) {
    // Fail-closed: read INTERNAL_API_KEY once at boot. If it's missing we
    // refuse to construct the controller rather than serving requests with
    // a broken auth gate.
    const internalKey = this.configService.get<string>('INTERNAL_API_KEY');
    if (!internalKey) {
      throw new Error(
        'INTERNAL_API_KEY environment variable is not configured',
      );
    }
    this.internalKeyBuf = Buffer.from(internalKey, 'utf8');
  }

  private requireInternal(apiKey: string | undefined): void {
    if (!apiKey) {
      throw new UnauthorizedException('Internal key required');
    }
    const given = Buffer.from(apiKey, 'utf8');
    // Length mismatch must short-circuit (timingSafeEqual would throw), but
    // still return 401 — never echo a "wrong length" diagnostic.
    if (given.length !== this.internalKeyBuf.length) {
      throw new UnauthorizedException('Internal key required');
    }
    if (!crypto.timingSafeEqual(given, this.internalKeyBuf)) {
      throw new UnauthorizedException('Internal key required');
    }
  }

  @Post('dispatch')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Dispatch incoming WebRTC call to a user (internal)',
  })
  @ApiHeader({ name: 'x-internal-key', required: true })
  async dispatch(
    @Body() body: DispatchBodyDto,
    @Headers('x-internal-key') internalKey?: string,
  ): Promise<DispatchResponse> {
    this.requireInternal(internalKey);

    const requestId = getCorrelationId() ?? uuidv4();
    const idempotencyKey = `signaling:dispatch:${body.event_id}:${body.user_id}`;
    const payloadHash = this.hashPayload(body);

    // Idempotency check: replay protection for AI-service retries.
    const cached = await this.readIdempotency(idempotencyKey);
    if (cached) {
      if (cached.payloadHash !== payloadHash) {
        throw new ConflictException({
          code: 'idempotency_key_payload_mismatch',
          message:
            'Dispatch with this (event_id, user_id) already in flight with a different payload',
          request_id: requestId,
        });
      }
      // Same key + same payload → replay the cached result without
      // emitting a second `incoming_call`.
      if (cached.status >= 400) {
        throw new HttpException(cached.body as object, cached.status);
      }
      return cached.body as DispatchResponse;
    }

    const payload = {
      event_id: body.event_id,
      script: body.script,
      channel: body.channel,
    };

    if (this.presence.isOnline(body.user_id)) {
      this.gateway.server
        .to(`user:${body.user_id}`)
        .emit('incoming_call', payload);
      this.logger.log(
        `dispatched incoming_call via socket user=${body.user_id} event=${body.event_id}`,
      );
      const response: DispatchResponse = { delivered: 'socket' };
      await this.writeIdempotency(idempotencyKey, {
        payloadHash,
        status: HttpStatus.CREATED,
        body: response,
      });
      return response;
    }

    // Offline → try Web Push. PushService returns counts rather than
    // throwing per-subscription; we translate (sent, failed, sub_count)
    // into the right HTTP outcome.
    let pushResult: { sent: number; failed: number };
    try {
      pushResult = await this.pushService.sendToUser(body.user_id, {
        title: 'Incoming emergency call',
        body: body.script || 'After-hours emergency awaiting acknowledgment',
        data: { ...payload, kind: 'incoming_call' },
      });
    } catch (err) {
      this.logger.error(
        `dispatch push threw: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      pushResult = { sent: 0, failed: 1 };
    }

    if (pushResult.sent > 0) {
      this.logger.log(
        `dispatched incoming_call via push user=${body.user_id} event=${body.event_id} sent=${pushResult.sent}`,
      );
      const response: DispatchResponse = { delivered: 'push' };
      await this.writeIdempotency(idempotencyKey, {
        payloadHash,
        status: HttpStatus.CREATED,
        body: response,
      });
      return response;
    }

    // Nothing was delivered. Differentiate "no endpoints to try" from
    // "had endpoints, all failed" so the caller (AI service) can decide
    // whether to skip this contact or retry.
    const code =
      pushResult.failed === 0 ? 'no_active_endpoints' : 'dispatch_undeliverable';
    const message =
      code === 'no_active_endpoints'
        ? 'User is offline and has no active push subscriptions'
        : 'User is offline and push delivery failed';

    this.logger.warn(
      `dispatch undeliverable user=${body.user_id} event=${body.event_id} code=${code}`,
    );

    const errorBody = {
      error: {
        code,
        message,
        request_id: requestId,
      },
    };

    await this.writeIdempotency(idempotencyKey, {
      payloadHash,
      status: HttpStatus.BAD_GATEWAY,
      body: errorBody,
    });

    throw new HttpException(errorBody, HttpStatus.BAD_GATEWAY);
  }

  // --- Idempotency helpers -------------------------------------------------

  private hashPayload(body: DispatchBodyDto): string {
    // Stable hash over the fields that affect delivery outcome.
    const canonical = JSON.stringify({
      user_id: body.user_id,
      event_id: body.event_id,
      script: body.script ?? null,
      channel: body.channel ?? null,
    });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  private async readIdempotency(
    key: string,
  ): Promise<IdempotencyRecord | null> {
    if (this.redis.isEnabled()) {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as IdempotencyRecord;
      } catch {
        return null;
      }
    }
    // Memory fallback
    const entry = memoryIdempotency.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      memoryIdempotency.delete(key);
      return null;
    }
    return entry.record;
  }

  private async writeIdempotency(
    key: string,
    record: IdempotencyRecord,
  ): Promise<void> {
    if (this.redis.isEnabled()) {
      await this.redis.setEx(
        key,
        JSON.stringify(record),
        IDEMPOTENCY_TTL_SECONDS,
      );
      return;
    }
    memoryIdempotency.set(key, {
      record,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_SECONDS * 1000,
    });
  }
}
