import {
  Body,
  Controller,
  Headers,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { SignalingGateway } from './signaling.gateway';
import { PresenceService } from '../presence/presence.service';
import { PushService } from '../push/push.service';

interface DispatchBody {
  user_id: string;
  event_id: string;
  script?: string;
  channel?: string;
}

@ApiTags('signaling')
@Controller('signaling')
export class SignalingController {
  private readonly logger = new Logger(SignalingController.name);

  constructor(
    private readonly gateway: SignalingGateway,
    private readonly presence: PresenceService,
    private readonly pushService: PushService,
    private readonly configService: ConfigService,
  ) {}

  private requireInternal(apiKey: string | undefined): void {
    const internalKey = this.configService.get<string>('INTERNAL_API_KEY');
    if (!internalKey) {
      throw new Error('INTERNAL_API_KEY environment variable is not configured');
    }
    if (apiKey !== internalKey) {
      throw new UnauthorizedException('Internal key required');
    }
  }

  @Post('dispatch')
  @ApiOperation({ summary: 'Dispatch incoming WebRTC call to a user (internal)' })
  @ApiHeader({ name: 'x-internal-key', required: true })
  async dispatch(
    @Body() body: DispatchBody,
    @Headers('x-internal-key') internalKey?: string,
  ): Promise<{ delivered: 'socket' | 'push' | 'none' }> {
    this.requireInternal(internalKey);

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
      return { delivered: 'socket' };
    }

    try {
      await this.pushService.sendToUser(body.user_id, {
        title: 'Incoming emergency call',
        body: body.script || 'After-hours emergency awaiting acknowledgment',
        data: { ...payload, kind: 'incoming_call' },
      });
      this.logger.log(
        `dispatched incoming_call via push user=${body.user_id} event=${body.event_id}`,
      );
      return { delivered: 'push' };
    } catch (err) {
      this.logger.error(
        `dispatch push failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
      return { delivered: 'none' };
    }
  }
}
