import { Module } from '@nestjs/common';
import { RotationService } from './rotation.service';
import { RotationController } from './rotation.controller';

@Module({
  providers: [RotationService],
  controllers: [RotationController],
  exports: [RotationService],
})
export class RotationModule {}
