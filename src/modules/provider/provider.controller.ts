import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { RegisterProviderDto, SetAvailabilityDto, VerifyProviderDto } from './provider.dto';
import { ProviderService } from './provider.service';

/** The provider-persona endpoints the app's provider screens call. */
@ApiTags('provider')
@ApiBearerAuth()
@Controller('provider')
export class ProviderController {
  constructor(private readonly service: ProviderService) {}

  @Post('registration')
  @ApiOperation({ summary: 'Submit a provider application (pending review)' })
  async register(
    @CurrentUser() user: AuthUser,
    @Body() dto: RegisterProviderDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.register(user, dto), 'Application submitted');
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Dashboard: business stats from the seller\u2019s orders' })
  async dashboard(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>> {
    return this.service.getDashboard(user);
  }

  @Get('schedule')
  @ApiOperation({ summary: 'Weekly availability + daily slots' })
  async schedule(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>> {
    return this.service.getSchedule(user);
  }

  @Get('earnings')
  @ApiOperation({ summary: 'Earnings summary + transaction history' })
  async earnings(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>> {
    return this.service.getEarnings(user);
  }

  @Post('availability')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle the online/available flag' })
  async availability(
    @CurrentUser() user: AuthUser,
    @Body() dto: SetAvailabilityDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.setAvailability(user, dto), 'Availability updated');
  }

  @Patch(':userId/verify')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Verify or reject a provider (admin) — verify grants the PROVIDER role',
  })
  async verify(
    @Param('userId') userId: string,
    @Body() dto: VerifyProviderDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.verify(userId, dto), 'Provider updated');
  }
}
