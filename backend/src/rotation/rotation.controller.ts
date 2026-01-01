import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RotationService } from './rotation.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@prisma/client';
import { CreateRotationDto, UpdateRotationDto } from './dto/rotation.dto';

@ApiTags('rotation')
@ApiBearerAuth()
@Controller('rotation')
@UseGuards(AuthGuard('jwt'))
export class RotationController {
  constructor(private rotationService: RotationService) {}

  @Get()
  @ApiOperation({ summary: 'Get all rotations' })
  async getAllRotations() {
    return this.rotationService.getAllRotations();
  }

  @Get('current')
  @ApiOperation({ summary: 'Get current on-call rotation' })
  async getCurrentRotation() {
    return this.rotationService.getCurrentRotation();
  }

  @Get('upcoming')
  @ApiOperation({ summary: 'Get upcoming rotations' })
  async getUpcomingRotations() {
    return this.rotationService.getUpcomingRotations();
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Create new rotation (admin only)' })
  async createRotation(@Body() dto: CreateRotationDto) {
    return this.rotationService.createRotation({
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
      primaryUserId: dto.primaryUserId,
      secondaryUserId: dto.secondaryUserId,
    });
  }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Update rotation (admin only)' })
  async updateRotation(@Param('id') id: string, @Body() dto: UpdateRotationDto) {
    return this.rotationService.updateRotation(id, {
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      primaryUserId: dto.primaryUserId,
      secondaryUserId: dto.secondaryUserId,
    });
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Delete rotation (admin only)' })
  async deleteRotation(@Param('id') id: string) {
    await this.rotationService.deleteRotation(id);
    return { success: true };
  }

  @Post('generate')
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiOperation({ summary: 'Manually trigger weekly rotation generation' })
  async generateRotation() {
    await this.rotationService.generateWeeklyRotation();
    return { success: true, message: 'Rotation generated' };
  }
}
