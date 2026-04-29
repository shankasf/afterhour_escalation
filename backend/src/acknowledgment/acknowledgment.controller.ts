import { Controller, Get, Post, Param, Body, UseGuards, Headers, UnauthorizedException, HttpException, HttpStatus, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import { AcknowledgmentService } from './acknowledgment.service';
import { AckMethod, UserRole } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

@ApiTags('acknowledgments')
@Controller('acknowledgments')
export class AcknowledgmentController {
  constructor(
    private ackService: AcknowledgmentService,
    private configService: ConfigService,
    private jwtService: JwtService,
  ) {}

  private isInternalRequest(apiKey: string | undefined): boolean {
    const internalKey = this.configService.get<string>('INTERNAL_API_KEY');
    if (!internalKey) {
      throw new Error('INTERNAL_API_KEY environment variable is not configured');
    }
    return apiKey === internalKey;
  }

  @Get(':eventId')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get acknowledgments for an event' })
  async getAcknowledgments(@Param('eventId') eventId: string) {
    return this.ackService.getAcknowledgments(eventId);
  }

  @Post()
  @ApiOperation({ summary: 'Create acknowledgment' })
  @ApiHeader({ name: 'x-internal-key', required: false })
  async create(
    @Body() body: {
      eventId: string;
      userId: string;
      method: AckMethod;
      notes?: string;
    },
    @Headers('x-internal-key') internalKey?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    // Allow internal service calls without JWT
    if (!this.isInternalRequest(internalKey) && !authHeader) {
      throw new UnauthorizedException('Authorization required');
    }
    return this.ackService.createAcknowledgment(body);
  }

  @Post('internal')
  @ApiOperation({ summary: 'Create acknowledgment (internal service)' })
  @ApiHeader({ name: 'x-internal-key', required: true })
  async createInternal(
    @Body() body: {
      eventId: string;
      userId?: string;
      phoneNumber?: string;
      method: AckMethod;
      notes?: string;
    },
    @Headers('x-internal-key') internalKey?: string,
  ) {
    if (!this.isInternalRequest(internalKey)) {
      throw new UnauthorizedException('Internal key required');
    }
    return this.ackService.createAcknowledgmentByPhone(body);
  }

  @Post(':eventId/downgrade')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Downgrade event to non-emergency' })
  async downgrade(
    @Param('eventId') eventId: string,
    @Body() body: { userId: string; reason: string },
  ) {
    return this.ackService.downgradeEvent(eventId, body.userId, body.reason);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel an acknowledgment and re-escalate (admin or internal-key only)',
  })
  @ApiHeader({ name: 'x-internal-key', required: false })
  async cancel(
    @Param('id') eventId: string,
    @Headers('x-internal-key') internalKey?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    const isInternal = internalKey
      ? this.isInternalRequest(internalKey)
      : false;

    if (!isInternal) {
      if (!authHeader) {
        throw new UnauthorizedException('Authorization required');
      }

      const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
      let payload: { sub?: string; role?: UserRole };
      try {
        payload = this.jwtService.verify(bearer);
      } catch {
        throw new UnauthorizedException('Invalid token');
      }

      if (payload.role !== UserRole.admin) {
        throw new ForbiddenException('Admin role required');
      }
    }

    return this.ackService.cancelAcknowledgment(eventId);
  }
}


/**
 * Singular path controller for AI service integration.
 * AI service calls POST /api/acknowledgment (singular) with different field names.
 */
@ApiTags('acknowledgment')
@Controller('acknowledgment')
export class AcknowledgmentInternalController {
  constructor(
    private ackService: AcknowledgmentService,
    private configService: ConfigService,
  ) {}

  private isInternalRequest(apiKey: string | undefined): boolean {
    const internalKey = this.configService.get<string>('INTERNAL_API_KEY');
    if (!internalKey) {
      throw new Error('INTERNAL_API_KEY environment variable is not configured');
    }
    return apiKey === internalKey;
  }

  @Post()
  @ApiOperation({ summary: 'Create acknowledgment (AI service format)' })
  @ApiHeader({ name: 'x-internal-key', required: true })
  async createFromAiService(
    @Body() body: {
      eventId: string;
      acknowledgedBy: string;
      method: string;
      timestamp?: string;
    },
    @Headers('x-internal-key') internalKey?: string,
  ) {
    if (!this.isInternalRequest(internalKey)) {
      throw new UnauthorizedException('Internal key required');
    }

    return this.ackService.createAcknowledgmentByName(body);
  }
}
