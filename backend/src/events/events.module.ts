import { Module } from '@nestjs/common';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { AiServiceModule } from '../ai-service/ai-service.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { EventRepository } from './repositories/event.repository';

@Module({
  imports: [AiServiceModule, WebsocketModule],
  providers: [
    EventRepository,
    EventsService,
  ],
  controllers: [EventsController],
  exports: [EventsService, EventRepository],
})
export class EventsModule {}
