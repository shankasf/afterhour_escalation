import { Body, Controller, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { EscalationService } from './escalation.service';

@ApiTags('escalation')
@Controller('escalation')
export class EscalationInternalController {
  constructor(
    private escalationService: EscalationService,
    private configService: ConfigService,
  ) {}

  private isInternalRequest(apiKey: string | undefined): boolean {
    const internalKey = this.configService.get<string>('INTERNAL_API_KEY') || 'internal-service-key';
    return apiKey === internalKey;
  }

  @Post('start/:eventId')
  @ApiOperation({ summary: 'Start escalation (internal service)' })
  @ApiHeader({ name: 'x-internal-key', required: true })
  async startEscalation(
    @Param('eventId') eventId: string,
    @Headers('x-internal-key') internalKey?: string,
  ) {
    if (!this.isInternalRequest(internalKey)) {
      throw new UnauthorizedException('Internal key required');
    }

    await this.escalationService.startEscalation(eventId);
    return { success: true, message: 'Escalation started' };
  }

  @Post('call-status')
  @ApiOperation({ summary: 'Update call status (internal service)' })
  @ApiHeader({ name: 'x-internal-key', required: true })
  async callStatus(
    @Body()
    body: {
      callSid: string;
      status: string;
      eventId?: string;
      escalationLogId?: string;
    },
    @Headers('x-internal-key') internalKey?: string,
  ) {
    if (!this.isInternalRequest(internalKey)) {
      throw new UnauthorizedException('Internal key required');
    }

    await this.escalationService.handleCallStatusCallback(body);
    return { success: true };
  }

  @Post('sms-status')
  @ApiOperation({ summary: 'Update SMS status (internal service)' })
  @ApiHeader({ name: 'x-internal-key', required: true })
  async smsStatus(
    @Body()
    body: {
      smsSid: string;
      status: string;
      eventId?: string;
      escalationLogId?: string;
    },
    @Headers('x-internal-key') internalKey?: string,
  ) {
    if (!this.isInternalRequest(internalKey)) {
      throw new UnauthorizedException('Internal key required');
    }

    await this.escalationService.handleSmsStatusCallback(body);
    return { success: true };
  }
}
