import { Body, Controller, Get, Headers, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { EscalationService } from './escalation.service';
import { PrismaService } from '../prisma/prisma.service';
import { RotationService } from '../rotation/rotation.service';

@ApiTags('escalation')
@Controller('escalation')
export class EscalationInternalController {
  constructor(
    private escalationService: EscalationService,
    private configService: ConfigService,
    private prisma: PrismaService,
    private rotationService: RotationService,
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

  @Post('log')
  @ApiOperation({ summary: 'Log escalation attempt (internal service)' })
  @ApiHeader({ name: 'x-internal-key', required: true })
  async logEscalationAttempt(
    @Body()
    body: {
      eventId: string;
      contactName: string;
      contactPhone: string;
      level: number;
      method: string;
      timestamp?: string;
    },
    @Headers('x-internal-key') internalKey?: string,
  ) {
    if (!this.isInternalRequest(internalKey)) {
      throw new UnauthorizedException('Internal key required');
    }

    // Find user by phone number or name
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { phoneNumber: body.contactPhone },
          { name: body.contactName },
        ],
      },
    });

    if (!user) {
      throw new Error(`User not found for contact: ${body.contactName} (${body.contactPhone})`);
    }

    // Find escalation contact for this user
    let escalationContact = await this.prisma.escalationContact.findFirst({
      where: { userId: user.id },
    });

    // If no escalation contact exists, try to find one by position
    if (!escalationContact) {
      escalationContact = await this.prisma.escalationContact.findFirst({
        where: { position: body.level },
      });
    }

    if (!escalationContact) {
      throw new Error(`Escalation contact not found for user ${user.id} at level ${body.level}`);
    }

    const log = await this.prisma.escalationLog.create({
      data: {
        eventId: body.eventId,
        contactId: escalationContact.id,
        userId: user.id,
        attemptNumber: body.level,
        callStatus: 'not_called',
        smsStatus: 'not_sent',
      },
    });

    return {
      id: log.id,
      createdAt: log.createdAt.toISOString(),
    };
  }

  @Post(':eventId/stop')
  @ApiOperation({ summary: 'Stop escalation (internal service)' })
  @ApiHeader({ name: 'x-internal-key', required: true })
  async stopEscalation(
    @Param('eventId') eventId: string,
    @Body() body: { reason: string },
    @Headers('x-internal-key') internalKey?: string,
  ) {
    if (!this.isInternalRequest(internalKey)) {
      throw new UnauthorizedException('Internal key required');
    }

    await this.escalationService.cancelEscalation(eventId);
    return { success: true, message: 'Escalation stopped', reason: body.reason };
  }

  @Get('ladder')
  @ApiOperation({ summary: 'Get escalation ladder (internal service)' })
  @ApiHeader({ name: 'x-internal-key', required: true })
  async getEscalationLadderInternal(
    @Headers('x-internal-key') internalKey?: string,
  ): Promise<any[]> {
    if (!this.isInternalRequest(internalKey)) {
      throw new UnauthorizedException('Internal key required');
    }

    return this.escalationService.buildEscalationLadder();
  }

  @Get('rotation/current')
  @ApiOperation({ summary: 'Get current rotation (internal service)' })
  @ApiHeader({ name: 'x-internal-key', required: true })
  async getCurrentRotationInternal(
    @Headers('x-internal-key') internalKey?: string,
  ) {
    if (!this.isInternalRequest(internalKey)) {
      throw new UnauthorizedException('Internal key required');
    }

    const rotation = await this.rotationService.getCurrentRotation() as any;

    if (!rotation) {
      return {
        primaryOnCall: null,
        secondaryOnCall: null,
        startDate: null,
        endDate: null,
      };
    }

    // Transform to match AI service expected format
    // The rotation includes primaryUser and secondaryUser relations
    return {
      primaryOnCall: rotation.primaryUser ? {
        name: rotation.primaryUser.name,
        phone: rotation.primaryUser.phoneNumber || '',
      } : null,
      secondaryOnCall: rotation.secondaryUser ? {
        name: rotation.secondaryUser.name,
        phone: rotation.secondaryUser.phoneNumber || '',
      } : null,
      startDate: rotation.startDate?.toISOString(),
      endDate: rotation.endDate?.toISOString(),
    };
  }
}
