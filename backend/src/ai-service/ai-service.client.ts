import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { getCorrelationId } from '../common/logging/correlation-id.context';

interface ClassificationResult {
  emergencyScore: number;
  shouldEscalate: boolean;
  extractedContext: {
    location?: string;
    equipment?: string;
    issueDescription?: string;
    urgencyIndicators?: string[];
  };
  reasoning?: string;
}

export interface EvalTargetRow {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number;
  cost_usd: number;
  judge_mean: number | null;
  langsmith_url: string | null;
}

export interface EvalSummary {
  last_run_at: string | null;
  runner: string | null;
  targets: Record<string, EvalTargetRow>;
  total_cost_usd: number;
  total_duration_ms: number;
  langsmith_project: string | null;
  judge_model: string | null;
}

export interface ScenarioTriage {
  decision: string;
  priority: string;
  emergency_score: number;
  is_safety_critical: boolean;
  issue_summary?: string;
  location?: string | null;
}

export interface ScenarioValidation {
  checks?: Array<[string, string, boolean]>;
  pass?: boolean;
}

export interface ScenarioResult {
  name: string;
  turns?: number;
  duration_ms?: number;
  triage?: ScenarioTriage | null;
  gate_status?: string;
  bot_replies?: string[];
  validation?: ScenarioValidation;
  error?: string;
}

export interface ScenarioSummary {
  passed: number;
  total: number;
  total_ms: number;
  llm_calls: number;
  tokens_in: number;
  tokens_out: number;
  total_cost_usd: number;
}

export interface ScenarioResults {
  results: ScenarioResult[];
  summary: ScenarioSummary | null;
}

export interface CostSummary {
  window: string;
  start: string;
  end: string;
  calls: number;
  total_cost_usd: number;
  tokens_in: number;
  cached_tokens: number;
  tokens_out: number;
  audio_tokens_in: number;
  audio_cached_tokens: number;
  audio_tokens_out: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  cache_hit_rate: number;
}

export interface CostByModelItem {
  model: string;
  calls: number;
  total_cost_usd: number;
  tokens_in: number;
  tokens_out: number;
  audio_tokens_in: number;
  audio_tokens_out: number;
}

export interface CostByAgentItem {
  agent: string;
  calls: number;
  total_cost_usd: number;
  avg_latency_ms: number;
}

export interface CostTimeseriesPoint {
  ts: string;
  calls: number;
  total_cost_usd: number;
}

export interface CostCallRow {
  id: string;
  run_id: string;
  root_run_id?: string | null;
  correlation_id?: string | null;
  source?: string;
  agent?: string | null;
  model: string;
  tokens_in: number;
  cached_tokens: number;
  tokens_out: number;
  audio_tokens_in: number;
  audio_cached_tokens: number;
  audio_tokens_out: number;
  cost_usd: number;
  latency_ms?: number | null;
  finish_reason?: string | null;
  created_at: string;
}

@Injectable()
export class AiServiceClient {
  private readonly logger = new Logger(AiServiceClient.name);
  private readonly baseUrl: string;

  constructor(
    private httpService: HttpService,
    private configService: ConfigService,
  ) {
    this.baseUrl = this.configService.get('AI_SERVICE_URL') || 'http://localhost:8083';
  }

  /**
   * Build outbound request headers, propagating the active correlation
   * id (if any) so the AI service can include it in its own logs.
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const correlationId = getCorrelationId();
    if (correlationId) {
      headers['x-correlation-id'] = correlationId;
    }
    return headers;
  }

  async classifyEmail(data: {
    subject: string;
    body: string;
    senderDomain: string;
  }): Promise<ClassificationResult> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/classify`, data, {
          timeout: 30000,
          headers: this.buildHeaders(),
        }),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Email classification failed: ${error.message}`);
      throw error;
    }
  }

  async generateVoiceMessage(data: {
    eventId: string;
    issueDescription: string;
    receivedAt: Date;
  }): Promise<{ audioUrl: string; script: string }> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/voice/generate`, data, {
          timeout: 30000,
          headers: this.buildHeaders(),
        }),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Voice generation failed: ${error.message}`);
      throw error;
    }
  }

  async generateSmsMessage(data: {
    eventId: string;
    issueDescription: string;
    receivedAt: Date;
  }): Promise<{ message: string }> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/sms/generate`, data, {
          timeout: 10000,
          headers: this.buildHeaders(),
        }),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`SMS generation failed: ${error.message}`);
      // Return a default message if AI fails
      return {
        message: `After-Hours Emergency – service request received at ${data.receivedAt.toLocaleTimeString()}. Reply ACK to accept.`,
      };
    }
  }

  async getEvalSummary(): Promise<EvalSummary> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<EvalSummary>(`${this.baseUrl}/eval/summary`, {
          timeout: 5000,
          headers: this.buildHeaders(),
        }),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Eval summary fetch failed: ${error.message}`);
      // Return empty payload so the dashboard still renders gracefully.
      return {
        last_run_at: null,
        runner: null,
        targets: {},
        total_cost_usd: 0,
        total_duration_ms: 0,
        langsmith_project: null,
        judge_model: null,
      };
    }
  }

  /**
   * Resume a parked LangGraph escalation by posting a channel_event.
   * Used by the ack-timeout cron and the /escalation/:id/decline route
   * to push the workflow past the ``wait_for_ack`` interrupt.
   */
  async postChannelEvent(
    eventId: string,
    channelEvent: { type: string; text?: string; transcript?: string; source?: string },
  ): Promise<void> {
    try {
      await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/graph/post_event`,
          { event_id: eventId, channel_event: channelEvent },
          { timeout: 15000, headers: this.buildHeaders() },
        ),
      );
    } catch (error) {
      this.logger.error(
        `postChannelEvent eventId=${eventId} type=${channelEvent.type} failed: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  private async getJson<T>(path: string, fallback: T): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<T>(`${this.baseUrl}${path}`, {
          timeout: 8000,
          headers: this.buildHeaders(),
        }),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`GET ${path} failed: ${(error as Error).message}`);
      return fallback;
    }
  }

  async getCostSummary(window: string): Promise<CostSummary> {
    return this.getJson<CostSummary>(`/cost/summary?window=${encodeURIComponent(window)}`, {
      window, start: '', end: '', calls: 0, total_cost_usd: 0,
      tokens_in: 0, cached_tokens: 0, tokens_out: 0,
      audio_tokens_in: 0, audio_cached_tokens: 0, audio_tokens_out: 0,
      avg_latency_ms: 0, p95_latency_ms: 0, cache_hit_rate: 0,
    });
  }

  async getCostByModel(window: string): Promise<{ window: string; items: CostByModelItem[] }> {
    return this.getJson(`/cost/by-model?window=${encodeURIComponent(window)}`, { window, items: [] });
  }

  async getCostByAgent(window: string): Promise<{ window: string; items: CostByAgentItem[] }> {
    return this.getJson(`/cost/by-agent?window=${encodeURIComponent(window)}`, { window, items: [] });
  }

  async getCostTimeseries(
    window: string,
    bucket: string,
  ): Promise<{ window: string; bucket: string; points: CostTimeseriesPoint[] }> {
    return this.getJson(
      `/cost/timeseries?window=${encodeURIComponent(window)}&bucket=${encodeURIComponent(bucket)}`,
      { window, bucket, points: [] },
    );
  }

  async getCostRecent(limit: number): Promise<{ items: CostCallRow[] }> {
    return this.getJson(`/cost/recent?limit=${limit}`, { items: [] });
  }

  async getCostTopCalls(window: string, limit: number): Promise<{ window: string; items: CostCallRow[] }> {
    return this.getJson(
      `/cost/top-calls?window=${encodeURIComponent(window)}&limit=${limit}`,
      { window, items: [] },
    );
  }

  async getEvalScenarios(): Promise<ScenarioResults> {
    try {
      const response = await firstValueFrom(
        this.httpService.get<ScenarioResults>(
          `${this.baseUrl}/eval/scenarios`,
          {
            timeout: 5000,
            headers: this.buildHeaders(),
          },
        ),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Eval scenarios fetch failed: ${error.message}`);
      // Return empty payload so the dashboard still renders gracefully.
      return { results: [], summary: null };
    }
  }
}
