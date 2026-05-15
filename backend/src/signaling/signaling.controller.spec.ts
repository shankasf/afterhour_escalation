import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import {
  ConflictException,
  HttpException,
  HttpStatus,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { SignalingController } from './signaling.controller';
import { SignalingGateway } from './signaling.gateway';
import { PresenceService } from '../presence/presence.service';
import { PushService } from '../push/push.service';
import { RedisService } from '../redis/redis.service';
import { DispatchBodyDto } from './dto/dispatch.dto';

/**
 * Unit tests for SignalingController covering:
 *  - constant-time internal-key auth
 *  - online → socket emit
 *  - offline + push failure → 502 dispatch_undeliverable
 *  - offline + no subscriptions → 502 no_active_endpoints
 *  - idempotency: replay-same returns cached
 *  - idempotency: same key + different payload → 409
 *  - DTO validation
 */
describe('SignalingController', () => {
  const INTERNAL_KEY = 'test-internal-key-1234567890';

  let controller: SignalingController;
  let gateway: { server: { to: jest.Mock } };
  let emitMock: jest.Mock;
  let toMock: jest.Mock;
  let presence: { isOnline: jest.Mock };
  let pushService: { sendToUser: jest.Mock };
  let redis: {
    isEnabled: jest.Mock;
    get: jest.Mock;
    setEx: jest.Mock;
  };

  async function buildModule(): Promise<TestingModule> {
    emitMock = jest.fn();
    toMock = jest.fn().mockReturnValue({ emit: emitMock });
    gateway = { server: { to: toMock } };

    presence = { isOnline: jest.fn() };
    pushService = { sendToUser: jest.fn() };
    redis = {
      isEnabled: jest.fn().mockReturnValue(false),
      get: jest.fn(),
      setEx: jest.fn(),
    };

    const configService = {
      get: jest.fn((key: string) =>
        key === 'INTERNAL_API_KEY' ? INTERNAL_KEY : undefined,
      ),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [SignalingController],
      providers: [
        { provide: SignalingGateway, useValue: gateway },
        { provide: PresenceService, useValue: presence },
        { provide: PushService, useValue: pushService },
        { provide: ConfigService, useValue: configService },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    controller = moduleRef.get(SignalingController);
    return moduleRef;
  }

  beforeEach(async () => {
    await buildModule();
  });

  function newBody(over: Partial<DispatchBodyDto> = {}): DispatchBodyDto {
    return {
      user_id: 'user-abc',
      event_id: `evt-${Math.random().toString(36).slice(2, 10)}`,
      script: 'Hello',
      channel: 'voice_webrtc',
      ...over,
    } as DispatchBodyDto;
  }

  // --- C7: internal-key auth ---------------------------------------------

  it('rejects with 401 when x-internal-key header is missing', async () => {
    await expect(controller.dispatch(newBody(), undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects with 401 when x-internal-key has wrong length (constant-time short-circuit)', async () => {
    await expect(controller.dispatch(newBody(), 'short')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects with 401 when x-internal-key has correct length but wrong value', async () => {
    // Same length as INTERNAL_KEY but different bytes.
    const wrong = 'x'.repeat(INTERNAL_KEY.length);
    expect(wrong.length).toBe(INTERNAL_KEY.length);
    await expect(controller.dispatch(newBody(), wrong)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  // --- C14: delivery outcomes --------------------------------------------

  it('returns delivered:socket and emits incoming_call when user is online', async () => {
    presence.isOnline.mockReturnValue(true);

    const body = newBody({ user_id: 'user-online' });
    const result = await controller.dispatch(body, INTERNAL_KEY);

    expect(result).toEqual({ delivered: 'socket' });
    expect(toMock).toHaveBeenCalledWith('user:user-online');
    expect(emitMock).toHaveBeenCalledWith('incoming_call', {
      event_id: body.event_id,
      script: body.script,
      channel: body.channel,
    });
    expect(pushService.sendToUser).not.toHaveBeenCalled();
  });

  it('returns 502 dispatch_undeliverable when offline + push has failures and zero sent', async () => {
    presence.isOnline.mockReturnValue(false);
    pushService.sendToUser.mockResolvedValue({ sent: 0, failed: 2 });

    let caught: any;
    try {
      await controller.dispatch(newBody(), INTERNAL_KEY);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    const body = caught.getResponse();
    expect(body.error.code).toBe('dispatch_undeliverable');
    expect(body.error.request_id).toBeDefined();
  });

  it('returns 502 no_active_endpoints when offline + zero subscriptions', async () => {
    presence.isOnline.mockReturnValue(false);
    pushService.sendToUser.mockResolvedValue({ sent: 0, failed: 0 });

    let caught: any;
    try {
      await controller.dispatch(newBody(), INTERNAL_KEY);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    const body = caught.getResponse();
    expect(body.error.code).toBe('no_active_endpoints');
    expect(body.error.request_id).toBeDefined();
  });

  it('returns delivered:push when push successfully reaches at least one endpoint', async () => {
    presence.isOnline.mockReturnValue(false);
    pushService.sendToUser.mockResolvedValue({ sent: 1, failed: 0 });

    const result = await controller.dispatch(newBody(), INTERNAL_KEY);
    expect(result).toEqual({ delivered: 'push' });
  });

  // --- C5: idempotency ----------------------------------------------------

  it('same (event_id, user_id) + same payload twice → second returns cached, no second emit', async () => {
    presence.isOnline.mockReturnValue(true);
    const body = newBody({ event_id: 'evt-idem-1', user_id: 'user-idem' });

    const first = await controller.dispatch(body, INTERNAL_KEY);
    const second = await controller.dispatch(body, INTERNAL_KEY);

    expect(first).toEqual({ delivered: 'socket' });
    expect(second).toEqual({ delivered: 'socket' });
    expect(emitMock).toHaveBeenCalledTimes(1);
  });

  it('same (event_id, user_id) + different payload → 409 idempotency_key_payload_mismatch', async () => {
    presence.isOnline.mockReturnValue(true);
    const first = newBody({
      event_id: 'evt-idem-2',
      user_id: 'user-idem',
      script: 'first',
    });
    const second = newBody({
      event_id: 'evt-idem-2',
      user_id: 'user-idem',
      script: 'second',
    });

    await controller.dispatch(first, INTERNAL_KEY);

    let caught: any;
    try {
      await controller.dispatch(second, INTERNAL_KEY);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    const body = caught.getResponse();
    expect(body.code).toBe('idempotency_key_payload_mismatch');
    expect(body.request_id).toBeDefined();
  });

  it('idempotency replay for a previously-failed dispatch re-throws the same error', async () => {
    presence.isOnline.mockReturnValue(false);
    pushService.sendToUser.mockResolvedValue({ sent: 0, failed: 0 });

    const body = newBody({ event_id: 'evt-idem-fail', user_id: 'user-idem' });

    let first: any;
    try {
      await controller.dispatch(body, INTERNAL_KEY);
    } catch (e) {
      first = e;
    }
    expect(first.getStatus()).toBe(HttpStatus.BAD_GATEWAY);

    // Second call: pushService should NOT be hit again — cached error replays.
    pushService.sendToUser.mockClear();
    let second: any;
    try {
      await controller.dispatch(body, INTERNAL_KEY);
    } catch (e) {
      second = e;
    }
    expect(second.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(pushService.sendToUser).not.toHaveBeenCalled();
  });

  // --- C1: DTO validation (run the pipe explicitly) ----------------------

  describe('DispatchBodyDto validation (via global ValidationPipe)', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });
    const meta = {
      type: 'body' as const,
      metatype: DispatchBodyDto,
      data: '',
    };

    it('rejects when user_id is missing → 400', async () => {
      await expect(
        pipe.transform({ event_id: 'evt-1' }, meta),
      ).rejects.toThrow();
    });

    it('rejects when event_id is missing → 400', async () => {
      await expect(
        pipe.transform({ user_id: 'u' }, meta),
      ).rejects.toThrow();
    });

    it('rejects when an unknown extra field is included → 400 (forbidNonWhitelisted)', async () => {
      await expect(
        pipe.transform(
          { user_id: 'u', event_id: 'e', injected: 'bad' },
          meta,
        ),
      ).rejects.toThrow();
    });

    it('rejects when script exceeds 4000 chars → 400', async () => {
      const errors = await validate(
        plainToInstance(DispatchBodyDto, {
          user_id: 'u',
          event_id: 'e',
          script: 'x'.repeat(4001),
        }),
      );
      expect(errors.length).toBeGreaterThan(0);
    });

    it('accepts a minimal valid payload', async () => {
      const dto = await pipe.transform(
        { user_id: 'u', event_id: 'e' },
        meta,
      );
      expect(dto).toMatchObject({ user_id: 'u', event_id: 'e' });
    });
  });
});
