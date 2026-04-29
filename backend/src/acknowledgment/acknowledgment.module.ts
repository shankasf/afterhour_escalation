import { Module } from '@nestjs/common';
import { AcknowledgmentService } from './acknowledgment.service';
import { AcknowledgmentController, AcknowledgmentInternalController } from './acknowledgment.controller';
import { EscalationModule } from '../escalation/escalation.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [EscalationModule, WebsocketModule, AuthModule],
  providers: [AcknowledgmentService],
  controllers: [AcknowledgmentController, AcknowledgmentInternalController],
  exports: [AcknowledgmentService],
})
export class AcknowledgmentModule {}
