import { Controller, Get, Patch, Post, Put, Delete, Body, Param, UseGuards, Headers, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '@prisma/client';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { ConfigService } from '@nestjs/config';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private usersService: UsersService,
    private configService: ConfigService,
  ) {}

  private isInternalRequest(apiKey: string | undefined): boolean {
    const internalKey = this.configService.get<string>('INTERNAL_API_KEY');
    if (!internalKey) {
      throw new Error('INTERNAL_API_KEY environment variable is not configured');
    }
    return apiKey === internalKey;
  }

  @Get()
  @ApiBearerAuth()
  @ApiHeader({ name: 'x-internal-key', required: false })
  @ApiOperation({ summary: 'Get all users' })
  async findAll(
    @Headers('x-internal-key') internalKey?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    // Allow internal service calls or JWT auth
    if (!this.isInternalRequest(internalKey) && !authHeader) {
      throw new UnauthorizedException('Authorization required');
    }
    return this.usersService.findAll();
  }

  @Get('on-call')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all on-call users' })
  async findOnCallUsers() {
    return this.usersService.findOnCallUsers();
  }

  @Get('rotation-candidates')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'List all on-duty-eligible staff (admin + on_call), ordered by onDutyPriority',
  })
  async findRotationCandidates() {
    return this.usersService.findRotationCandidates();
  }

  @Patch(':id/duty')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle a staff member on/off duty (admin only)' })
  async setDuty(
    @Param('id') id: string,
    @Body() body: { onDuty: boolean },
  ) {
    return this.usersService.setOnDuty(id, !!body.onDuty);
  }

  @Patch(':id/duty-priority')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set on-duty routing priority (lower = earlier; admin only)' })
  async setDutyPriority(
    @Param('id') id: string,
    @Body() body: { priority: number },
  ) {
    const n = Math.max(1, Math.min(9999, Number(body.priority) || 100));
    return this.usersService.setOnDutyPriority(id, n);
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user by ID' })
  async findOne(@Param('id') id: string) {
    return this.usersService.findById(id);
  }

  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create new user (admin only)' })
  async create(@Body() createUserDto: CreateUserDto) {
    return this.usersService.create(createUserDto);
  }

  @Put(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user (admin only)' })
  async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.usersService.update(id, updateUserDto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles(UserRole.admin)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Deactivate user (admin only)' })
  async remove(@Param('id') id: string) {
    return this.usersService.deactivate(id);
  }
}
