import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { AgentTraceIngestDto, AgentTrackingService } from './agent-tracking.service';

@ApiTags('agent-tracking')
@Controller('agent-tracking')
export class AgentTrackingController {
  constructor(
    private readonly agentTrackingService: AgentTrackingService,
    private readonly configService: ConfigService,
  ) {}

  @Get('dashboard')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get agent observability and evaluation dashboard data' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async getDashboard(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.agentTrackingService.getDashboard(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Post('traces')
  @ApiOperation({ summary: 'Ingest an AI service trace for observability and online evaluation' })
  async ingestTrace(
    @Headers('x-internal-key') internalKey: string | undefined,
    @Body() body: AgentTraceIngestDto,
  ) {
    this.assertInternal(internalKey);
    return this.agentTrackingService.ingestTrace(body);
  }

  @Post('backfill')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Backfill persisted agent traces from historical events' })
  @ApiQuery({ name: 'startDate', required: false })
  @ApiQuery({ name: 'endDate', required: false })
  async backfill(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    const processed = await this.agentTrackingService.backfillMissingEventTraces(start, end);
    return { processed };
  }

  private assertInternal(internalKey: string | undefined): void {
    const expected = this.configService.get<string>('INTERNAL_API_KEY');
    if (!expected || internalKey !== expected) {
      throw new UnauthorizedException('Invalid internal API key');
    }
  }
}
