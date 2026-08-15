import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DriverService } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import {
  DriverLocationDto,
  NearbyQueryDto,
  NearbyVehicleDto,
  RegisterDriverDto,
  SetOnlineDto,
} from './dispatch.dto';
import { DispatchService } from './dispatch.service';

/**
 * The partner side of taxi and porter: who is driving, whether they are on
 * duty, and where they are.
 *
 * The rider side lives in the rides and porter modules; only the map feed
 * (`/dispatch/nearby`) is here, because both products answer it the same way.
 */
@ApiTags('dispatch')
@ApiBearerAuth()
@Controller('dispatch')
export class DispatchController {
  constructor(private readonly service: DispatchService) {}

  @Get('me')
  @ApiOperation({ summary: 'The vehicles this user is registered to drive' })
  async profiles(@CurrentUser() user: AuthUser): Promise<ApiResponse<Record<string, unknown>[]>> {
    return ApiResponse.of(await this.service.listProfiles(user));
  }

  @Post('register')
  @ApiOperation({ summary: 'Register (or update) the vehicle this partner runs' })
  async register(
    @CurrentUser() user: AuthUser,
    @Body() dto: RegisterDriverDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.register(user, dto), 'Vehicle saved');
  }

  @Post('online')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Go on or off duty' })
  async setOnline(
    @CurrentUser() user: AuthUser,
    @Body() dto: SetOnlineDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const profile = await this.service.setOnline(user, dto);
    return ApiResponse.of(profile, dto.isOnline ? 'You are online' : 'You are offline');
  }

  @Post('location')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Heartbeat: where the partner is now' })
  async location(
    @CurrentUser() user: AuthUser,
    @Body() dto: DriverLocationDto,
  ): Promise<ApiResponse<{ ok: true }>> {
    return ApiResponse.of(await this.service.updateLocation(user, dto));
  }

  @Get('nearby/rides')
  @ApiOperation({ summary: 'Taxis on duty near a point — the pins on the rider map' })
  async nearbyRides(@Query() query: NearbyQueryDto): Promise<ApiResponse<NearbyVehicleDto[]>> {
    return ApiResponse.of(await this.service.nearbyVehicles(DriverService.RIDE, query));
  }

  @Get('nearby/porter')
  @ApiOperation({ summary: 'Delivery partners on duty near a point' })
  async nearbyPorter(@Query() query: NearbyQueryDto): Promise<ApiResponse<NearbyVehicleDto[]>> {
    return ApiResponse.of(await this.service.nearbyVehicles(DriverService.PORTER, query));
  }
}
