import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AiServiceClient,
  EvalSummary,
  ScenarioResults,
} from '../ai-service/ai-service.client';

@ApiTags('eval')
@Controller('eval')
export class EvalController {
  constructor(private readonly aiServiceClient: AiServiceClient) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Get the most recent sub-graph eval-run summary',
  })
  async getSummary(): Promise<EvalSummary> {
    return this.aiServiceClient.getEvalSummary();
  }

  @Get('scenarios')
  @ApiOperation({
    summary: 'Get the most recent customer-chat scenario test results',
  })
  async getScenarios(): Promise<ScenarioResults> {
    return this.aiServiceClient.getEvalScenarios();
  }
}
