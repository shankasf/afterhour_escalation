import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuthModule } from '../auth/auth.module';
import { PresenceModule } from '../presence/presence.module';
import { PushModule } from '../push/push.module';
import { RedisModule } from '../redis/redis.module';
import { SignalingGateway } from './signaling.gateway';
import { SignalingController } from './signaling.controller';

@Module({
  imports: [AuthModule, PresenceModule, PushModule, HttpModule, RedisModule],
  providers: [SignalingGateway],
  controllers: [SignalingController],
  exports: [SignalingGateway],
})
export class SignalingModule {}
