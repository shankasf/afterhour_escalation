import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AiServiceClient } from '../ai-service/ai-service.client';

const ALLOWED_WINDOWS = new Set(['1h', '24h', '7d', '30d', '90d']);
const ALLOWED_BUCKETS = new Set(['hour', 'day']);

@ApiTags('cost')
@Controller('cost')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class CostController {
  constructor(private readonly aiServiceClient: AiServiceClient) {}

  private window(w?: string): string {
    return w && ALLOWED_WINDOWS.has(w) ? w : '24h';
  }

  @Get('summary')
  @ApiOperation({ summary: 'Total LLM spend + token usage over a window' })
  @ApiQuery({ name: 'window', required: false, enum: ['1h', '24h', '7d', '30d', '90d'] })
  async getSummary(@Query('window') window?: string) {
    return this.aiServiceClient.getCostSummary(this.window(window));
  }

  @Get('by-model')
  @ApiOperation({ summary: 'Spend broken down by model id' })
  @ApiQuery({ name: 'window', required: false })
  async getByModel(@Query('window') window?: string) {
    return this.aiServiceClient.getCostByModel(this.window(window));
  }

  @Get('by-agent')
  @ApiOperation({ summary: 'Spend broken down by agent / target' })
  @ApiQuery({ name: 'window', required: false })
  async getByAgent(@Query('window') window?: string) {
    return this.aiServiceClient.getCostByAgent(this.window(window));
  }

  @Get('timeseries')
  @ApiOperation({ summary: 'Spend bucketed by hour or day' })
  @ApiQuery({ name: 'window', required: false })
  @ApiQuery({ name: 'bucket', required: false, enum: ['hour', 'day'] })
  async getTimeseries(
    @Query('window') window?: string,
    @Query('bucket') bucket?: string,
  ) {
    const b = bucket && ALLOWED_BUCKETS.has(bucket) ? bucket : 'hour';
    return this.aiServiceClient.getCostTimeseries(this.window(window), b);
  }

  @Get('recent')
  @ApiOperation({ summary: 'Most recent LLM calls (newest first)' })
  @ApiQuery({ name: 'limit', required: false })
  async getRecent(@Query('limit') limit?: string) {
    const n = Math.max(1, Math.min(500, Number(limit) || 50));
    return this.aiServiceClient.getCostRecent(n);
  }

  @Get('top-calls')
  @ApiOperation({ summary: 'Most expensive single LLM calls in the window' })
  @ApiQuery({ name: 'window', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getTopCalls(
    @Query('window') window?: string,
    @Query('limit') limit?: string,
  ) {
    const n = Math.max(1, Math.min(100, Number(limit) || 20));
    return this.aiServiceClient.getCostTopCalls(this.window(window), n);
  }
}
