import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserType } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { AdminUsersService } from './admin-users.service';
import {
  AdminStatsDto,
  AdminUserDto,
  AdminUsersQueryDto,
  CreateStaffDto,
  UpdateStaffDto,
} from './admin.dto';

/** The super admin's Users tab. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(UserType.SUPER_ADMIN)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'App users, newest first; search by name or phone' })
  async list(@Query() query: AdminUsersQueryDto): Promise<ApiResponse<AdminUserDto[]>> {
    const { items, meta } = await this.users.list(query);
    return ApiResponse.of(items, 'OK', meta);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Dashboard counts: users by role, seller listings, and admin-run services',
  })
  async stats(): Promise<AdminStatsDto> {
    return this.users.stats();
  }

  @Post()
  @ApiOperation({ summary: 'Create an admin or super admin account (role fixed for life)' })
  async createStaff(
    @Body() dto: CreateStaffDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<AdminUserDto>> {
    return ApiResponse.of(await this.users.createStaff(dto, user.id), 'Account created');
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit an admin’s or super admin’s details (never the role)' })
  async updateStaff(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AdminUserDto> {
    return this.users.updateStaff(id, dto, user.id);
  }
}
