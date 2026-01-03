import { Module } from '@nestjs/common';
import { EmailTrackingController } from './email-tracking.controller';
import { EmailTrackingService } from './email-tracking.service';

@Module({
  controllers: [EmailTrackingController],
  providers: [EmailTrackingService],
  exports: [EmailTrackingService],
})
export class EmailTrackingModule {}
