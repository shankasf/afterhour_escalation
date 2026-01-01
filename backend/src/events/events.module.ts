import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { AiServiceModule } from '../ai-service/ai-service.module';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [AiServiceModule, WebsocketModule],
  providers: [EventsService],
  controllers: [EventsController],
  exports: [EventsService],
})
export class EventsModule {}
