import { Module } from '@nestjs/common';
import { WebsocketGateway } from './websocket.gateway';
import { AuthModule } from '../auth/auth.module';
import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [AuthModule, PresenceModule],
  providers: [WebsocketGateway],
  exports: [WebsocketGateway],
})
export class WebsocketModule {}
