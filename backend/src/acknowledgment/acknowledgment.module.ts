import { Module } from '@nestjs/common';
import { AcknowledgmentService } from './acknowledgment.service';
import { AcknowledgmentController } from './acknowledgment.controller';
import { EscalationModule } from '../escalation/escalation.module';

@Module({
  imports: [EscalationModule],
  providers: [AcknowledgmentService],
  controllers: [AcknowledgmentController],
  exports: [AcknowledgmentService],
})
export class AcknowledgmentModule {}
