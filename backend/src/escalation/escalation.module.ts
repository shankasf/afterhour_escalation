import { Module, forwardRef } from '@nestjs/common';
import { EscalationService } from './escalation.service';
import { EscalationController } from './escalation.controller';
import { EscalationInternalController } from './escalation.internal.controller';
import { RotationModule } from '../rotation/rotation.module';
import { AiServiceModule } from '../ai-service/ai-service.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { AlertsModule } from '../alerts/alerts.module';
import { SettingsModule } from '../settings/settings.module';
import { EventsModule } from '../events/events.module';

// New focused services
import { EscalationRepository } from './repositories/escalation.repository';
import { LadderBuilderService } from './services/ladder-builder.service';
import { StatusTrackerService } from './services/status-tracker.service';
import { AcknowledgmentHandlerService } from './services/acknowledgment-handler.service';
import { EscalationCoordinatorService } from './services/escalation-coordinator.service';
import { LadderConfigService } from './services/ladder-config.service';

@Module({
  imports: [
    RotationModule,
    AiServiceModule,
    WebsocketModule,
    AlertsModule,
    SettingsModule,
    forwardRef(() => EventsModule),
  ],
  providers: [
    // Repository
    EscalationRepository,
    // Focused services
    LadderConfigService,
    LadderBuilderService,
    StatusTrackerService,
    AcknowledgmentHandlerService,
    EscalationCoordinatorService,
    // Legacy service (maintained for backward compatibility)
    EscalationService,
  ],
  controllers: [EscalationController, EscalationInternalController],
  exports: [
    EscalationService,
    EscalationCoordinatorService,
    EscalationRepository,
    LadderConfigService,
  ],
})
export class EscalationModule {}
