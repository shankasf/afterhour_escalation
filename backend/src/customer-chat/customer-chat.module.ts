import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CustomerChatController } from './customer-chat.controller';
import { CustomerChatGateway } from './customer-chat.gateway';
import { ChatSessionService } from './chat-session.service';

@Module({
  imports: [HttpModule],
  controllers: [CustomerChatController],
  providers: [CustomerChatGateway, ChatSessionService],
  exports: [ChatSessionService],
})
export class CustomerChatModule {}
