import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserType } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { AdminUsersService } from './admin-users.service';
import { AdminStatsDto, AdminUserDto, AdminUsersQueryDto, SetUserRoleDto } from './admin.dto';

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

  @Patch(':id/role')
  @ApiOperation({ summary: 'Change a user’s role; an ADMIN also gets their modules' })
  async setRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserRoleDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AdminUserDto> {
    return this.users.setRole(id, dto.role, user.id, dto.modules);
  }
}
