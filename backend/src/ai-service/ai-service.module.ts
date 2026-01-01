import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AiServiceClient } from './ai-service.client';

@Module({
  imports: [HttpModule],
  providers: [AiServiceClient],
  exports: [AiServiceClient],
})
export class AiServiceModule {}
