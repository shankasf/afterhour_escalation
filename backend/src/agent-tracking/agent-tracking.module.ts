import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentTrackingController } from './agent-tracking.controller';
import { AgentTrackingService } from './agent-tracking.service';

@Module({
  imports: [PrismaModule],
  controllers: [AgentTrackingController],
  providers: [AgentTrackingService],
  exports: [AgentTrackingService],
})
export class AgentTrackingModule {}
