import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Get system health status' })
  async getHealth() {
    return this.healthService.getHealth();
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Get system metrics' })
  async getMetrics() {
    return this.healthService.getMetrics();
  }
}
