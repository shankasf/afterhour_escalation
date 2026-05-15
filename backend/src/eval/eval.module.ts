import { Module } from '@nestjs/common';
import { AiServiceModule } from '../ai-service/ai-service.module';
import { EvalController } from './eval.controller';

@Module({
  imports: [AiServiceModule],
  controllers: [EvalController],
})
export class EvalModule {}
