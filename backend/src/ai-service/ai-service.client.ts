import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

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

interface EscalationResult {
  callSid?: string;
  smsSid?: string;
  success: boolean;
  error?: string;
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

  async classifyEmail(data: {
    subject: string;
    body: string;
    senderDomain: string;
  }): Promise<ClassificationResult> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/classify`, data, {
          timeout: 30000,
        }),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Email classification failed: ${error.message}`);
      throw error;
    }
  }

  async processDialpadEvent(data: {
    phoneNumber: string;
    transcription?: string;
  }): Promise<{ shouldEscalate: boolean; context: any }> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/dialpad/process`, data, {
          timeout: 30000,
        }),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Dialpad processing failed: ${error.message}`);
      // For Dialpad events, always escalate even if AI fails
      return { shouldEscalate: true, context: {} };
    }
  }

  async sendEscalation(data: {
    eventId: string;
    escalationLogId: string;
    contact: { name: string; phone: string };
    event: any;
  }): Promise<EscalationResult> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/escalate`, data, {
          timeout: 60000,
        }),
      );
      return response.data;
    } catch (error) {
      this.logger.error(`Escalation failed: ${error.message}`);
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
