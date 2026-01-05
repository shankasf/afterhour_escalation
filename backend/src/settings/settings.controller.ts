import {
  Controller, Get, Post, Put, Patch, Delete,
  Param, Body, UseGuards, Request
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { SettingsService } from './settings.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@prisma/client';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
@UseGuards(AuthGuard('jwt'))
export class SettingsController {
  constructor(private settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get all system settings' })
  async getAllSettings() {
    return this.settingsService.getAllSettings();
  }

  // Keywords endpoints - MUST be before parameterized routes to avoid route conflicts
  @Get('keywords')
  @ApiOperation({ summary: 'Get all emergency keywords' })
  async getAllKeywords() {
    return this.settingsService.getAllKeywords();
  }

  @Post('keywords')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Create emergency keyword (admin only)' })
  async createKeyword(
    @Body() body: {
      keyword: string;
      weight: number;
      category?: string;
      isNegative?: boolean;
    },
  ) {
    return this.settingsService.createKeyword(body);
  }

  @Put('keywords/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Update emergency keyword (admin only)' })
  async updateKeyword(
    @Param('id') id: string,
    @Body() body: {
      keyword?: string;
      weight?: number;
      category?: string;
      isNegative?: boolean;
      isActive?: boolean;
    },
  ) {
    return this.settingsService.updateKeyword(id, body);
  }

  @Delete('keywords/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Delete emergency keyword (admin only)' })
  async deleteKeyword(@Param('id') id: string) {
    await this.settingsService.deleteKeyword(id);
    return { success: true };
  }

  // Parameterized routes - MUST be after specific routes
  @Get(':key')
  @ApiOperation({ summary: 'Get setting by key' })
  async getSetting(@Param('key') key: string) {
    const value = await this.settingsService.getSetting(key);
    return { key, value };
  }

  @Put(':key')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Update setting (admin only)' })
  async updateSettingPut(
    @Param('key') key: string,
    @Body() body: { value: string },
    @Request() req: any,
  ) {
    return this.settingsService.updateSetting(key, body.value, req.user.userId);
  }

  @Patch(':key')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Update setting (admin only)' })
  async updateSetting(
    @Param('key') key: string,
    @Body() body: { value: string },
    @Request() req: any,
  ) {
    return this.settingsService.updateSetting(key, body.value, req.user.userId);
  }
}
