import { Module } from '@nestjs/common';
import { AiServiceModule } from '../ai-service/ai-service.module';
import { CostController } from './cost.controller';

@Module({
  imports: [AiServiceModule],
  controllers: [CostController],
})
export class CostModule {}
