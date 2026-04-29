import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { EscalationService } from './escalation.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('escalation')
@ApiBearerAuth()
@Controller('escalation')
@UseGuards(AuthGuard('jwt'))
export class EscalationController {
  constructor(private escalationService: EscalationService) {}

  @Get('active')
  @ApiOperation({ summary: 'Get all active escalations with live status' })
  async getActiveEscalations() {
    const [escalations, count] = await Promise.all([
      this.escalationService.getActiveEscalations(),
      this.escalationService.getActiveEscalationCount(),
    ]);
    return {
      count,
      escalations,
    };
  }

  @Get('contacts')
  @ApiOperation({ summary: 'Get all escalation contacts' })
  async getContacts() {
    return this.escalationService.getEscalationContacts();
  }

  @Post('contacts')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Create escalation contact' })
  async createContact(@Body() body: { userId: string; contactType: string; position: number }) {
    return this.escalationService.createEscalationContact(body);
  }

  @Patch('contacts/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Update escalation contact' })
  async updateContact(
    @Param('id') id: string,
    @Body() body: { position?: number; isActive?: boolean },
  ) {
    return this.escalationService.updateEscalationContact(id, body);
  }

  @Delete('contacts/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Delete escalation contact' })
  async deleteContact(@Param('id') id: string) {
    await this.escalationService.deleteEscalationContact(id);
    return { success: true };
  }

  @Post(':eventId/start')
  @ApiOperation({ summary: 'Start escalation for an event' })
  async startEscalation(@Param('eventId') eventId: string) {
    await this.escalationService.startEscalation(eventId);
    return { success: true, message: 'Escalation started' };
  }

  @Post(':eventId/cancel')
  @ApiOperation({ summary: 'Cancel active escalation' })
  async cancelEscalation(@Param('eventId') eventId: string) {
    await this.escalationService.cancelEscalation(eventId);
    return { success: true, message: 'Escalation cancelled' };
  }

  @Get(':eventId/logs')
  @ApiOperation({ summary: 'Get escalation logs for an event' })
  async getEscalationLogs(@Param('eventId') eventId: string) {
    return this.escalationService.getEscalationLogs(eventId);
  }

  @Get('ladder')
  @ApiOperation({ summary: 'Get current escalation ladder' })
  async getEscalationLadder(): Promise<any[]> {
    return this.escalationService.buildEscalationLadder();
  }

  @Post('acknowledge')
  @ApiOperation({ summary: 'Manual acknowledgment (for testing)' })
  async acknowledge(
    @Body() body: { eventId: string; userId: string; method: 'sms' | 'call' },
  ) {
    await this.escalationService.handleAcknowledgment(
      body.eventId,
      body.userId,
      body.method,
    );
    return { success: true };
  }
}
