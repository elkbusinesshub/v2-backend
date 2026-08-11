import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { CreateNotificationDto, RegisterDeviceDto, UnregisterDeviceDto } from './notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'My notifications, newest first' })
  async list(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>[]> {
    return this.service.list(user);
  }

  @Post('mark-all-read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark every notification read' })
  async markAllRead(@CurrentUser() user: AuthUser): Promise<ApiResponse<null>> {
    await this.service.markAllRead(user);
    return ApiResponse.of(null, 'Marked all read');
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Raise a notification for a user (ops/admin)' })
  async create(@Body() dto: CreateNotificationDto): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.create(dto), 'Notification created');
  }

  @Post('devices')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Register this device's FCM token for push" })
  async registerDevice(
    @CurrentUser() user: AuthUser,
    @Body() dto: RegisterDeviceDto,
  ): Promise<ApiResponse<null>> {
    await this.service.registerDevice(user.id, dto.token, dto.platform);
    return ApiResponse.of(null, 'Device registered');
  }

  @Delete('devices')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop pushing to this device (called on sign-out)' })
  async unregisterDevice(
    @CurrentUser() user: AuthUser,
    @Body() dto: UnregisterDeviceDto,
  ): Promise<ApiResponse<null>> {
    await this.service.unregisterDevice(user.id, dto.token);
    return ApiResponse.of(null, 'Device removed');
  }
}
