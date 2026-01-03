/**
 * Email Tracking Controller
 * Handles API endpoints for email UID tracking.
 * Used by the AI service to track processed emails.
 */

import { Controller, Get, Post, Body, Headers, UnauthorizedException, Logger } from '@nestjs/common';
import { EmailTrackingService } from './email-tracking.service';
import { ConfigService } from '@nestjs/config';

@Controller('email-tracking')
export class EmailTrackingController {
  private readonly logger = new Logger(EmailTrackingController.name);

  constructor(
    private readonly emailTrackingService: EmailTrackingService,
    private readonly configService: ConfigService,
  ) {}

  private validateInternalKey(key: string): void {
    const expectedKey = this.configService.get<string>('INTERNAL_API_KEY');
    if (key !== expectedKey) {
      throw new UnauthorizedException('Invalid internal API key');
    }
  }

  @Get('processed-uids')
  async getProcessedUids(@Headers('x-internal-key') internalKey: string) {
    this.validateInternalKey(internalKey);
    const uids = await this.emailTrackingService.getProcessedUids();
    return { uids };
  }

  @Post('mark-processed')
  async markProcessed(
    @Headers('x-internal-key') internalKey: string,
    @Body() body: { uid: string; processedAt?: string },
  ) {
    this.validateInternalKey(internalKey);
    await this.emailTrackingService.markProcessed(body.uid, body.processedAt);
    return { success: true };
  }
}
