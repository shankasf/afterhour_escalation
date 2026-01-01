import { Controller, Get, Post, Put, Param, Body, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { AlertsService } from './alerts.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('alerts')
@ApiBearerAuth()
@Controller('alerts')
@UseGuards(AuthGuard('jwt'))
export class AlertsController {
  constructor(private alertsService: AlertsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all alerts' })
  @ApiQuery({ name: 'resolved', required: false, type: Boolean })
  async findAll(@Query('resolved') resolved?: string) {
    const resolvedBool = resolved !== undefined 
      ? resolved === 'true' 
      : undefined;
    return this.alertsService.findAll(resolvedBool);
  }

  @Get('unresolved-count')
  @ApiOperation({ summary: 'Get count of unresolved alerts' })
  async getUnresolvedCount() {
    const count = await this.alertsService.getUnresolvedCount();
    return { count };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get alert by ID' })
  async findOne(@Param('id') id: string) {
    return this.alertsService.findById(id);
  }

  @Put(':id/resolve')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Resolve an alert (admin only)' })
  async resolve(@Param('id') id: string, @Request() req: any) {
    return this.alertsService.resolve(id, req.user.userId);
  }
}
