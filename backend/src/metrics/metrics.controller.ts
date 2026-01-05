import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { MetricsService } from './metrics.service';

@ApiTags('metrics')
@ApiBearerAuth()
@Controller('metrics')
@UseGuards(AuthGuard('jwt'))
export class MetricsController {
  constructor(private metricsService: MetricsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard metrics' })
  async getDashboardMetrics() {
    return this.metricsService.getDashboardMetrics();
  }

  @Get('comprehensive')
  @ApiOperation({ summary: 'Get comprehensive AI and business metrics' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (defaults to 30 days ago)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (defaults to now)' })
  async getComprehensiveMetrics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.metricsService.getComprehensiveMetrics(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('weekly')
  @ApiOperation({ summary: 'Get weekly metrics' })
  async getWeeklyMetrics() {
    return this.metricsService.getWeeklyMetrics();
  }

  @Get('daily')
  @ApiOperation({ summary: 'Get daily metrics' })
  @ApiQuery({ name: 'date', required: false })
  async getDailyMetrics(@Query('date') date?: string) {
    return this.metricsService.getDailyMetrics(date ? new Date(date) : undefined);
  }

  @Get('range')
  @ApiOperation({ summary: 'Get metrics for date range' })
  @ApiQuery({ name: 'startDate', required: true })
  @ApiQuery({ name: 'endDate', required: true })
  async getMetricsRange(
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return this.metricsService.getMetricsRange(
      new Date(startDate),
      new Date(endDate),
    );
  }

  @Get('sla')
  @ApiOperation({ summary: 'Get SLA compliance metrics' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getSlaCompliance(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.metricsService.getSlaCompliance(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }
}
