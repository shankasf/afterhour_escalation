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
}
