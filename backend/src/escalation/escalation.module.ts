import { Module } from '@nestjs/common';
import { EscalationService } from './escalation.service';
import { EscalationController } from './escalation.controller';
import { RotationModule } from '../rotation/rotation.module';
import { AiServiceModule } from '../ai-service/ai-service.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { AlertsModule } from '../alerts/alerts.module';

@Module({
  imports: [RotationModule, AiServiceModule, WebsocketModule, AlertsModule],
  providers: [EscalationService],
  controllers: [EscalationController],
  exports: [EscalationService],
})
export class EscalationModule {}
