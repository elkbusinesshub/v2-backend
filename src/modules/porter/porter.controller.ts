import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { CreatePorterBookingDto, PorterOtpDto, PorterQuoteDto } from './porter.dto';
import { PorterService } from './porter.service';

/**
 * `/porter/options` and `/porter/bookings` are the exact paths the Flutter
 * repository already calls; the rest are what its booking flow needs to go
 * live.
 */
@ApiTags('porter')
@ApiBearerAuth()
@Controller('porter')
export class PorterController {
  constructor(private readonly service: PorterService) {}

  @Get('options')
  @ApiOperation({ summary: 'Vehicles, add-ons, pickup windows, fee constants' })
  async options(): Promise<Record<string, unknown>> {
    return this.service.getOptions();
  }

  /** Fare-review breakdown; identical math to booking creation, no side effects. */
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Price a delivery (server-side checkout formula)' })
  async quote(@Body() dto: PorterQuoteDto): Promise<Record<string, unknown>> {
    return this.service.quote(dto);
  }

  @Post('bookings')
  @ApiOperation({ summary: 'Book a porter (now or scheduled, mock payment)' })
  async createBooking(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePorterBookingDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const booking = await this.service.createBooking(user, dto);
    return ApiResponse.of(booking, 'Booking confirmed');
  }

  @Get('bookings')
  @ApiOperation({ summary: 'My porter deliveries' })
  async listBookings(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>[]> {
    return this.service.listBookings(user);
  }

  @Get('bookings/:id')
  @ApiOperation({ summary: 'Delivery detail (tracking card)' })
  async getBooking(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, unknown>> {
    return this.service.getBooking(user, id);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Free cancellation — before pickup only' })
  async cancelBooking(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<null>> {
    await this.service.cancelBooking(user, id);
    return ApiResponse.of(null, 'Booking cancelled — refund issued');
  }

  // ─── fulfilment (ops/admin until rider assignment exists) ──────────────────

  @Post('bookings/:id/pickup')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm package handover → PICKED_UP (ops/admin)' })
  async confirmPickup(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.confirmPickup(id), 'Pickup confirmed');
  }

  @Post('bookings/:id/deliver')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm drop-off → DELIVERED (ops/admin)' })
  async confirmDelivery(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.confirmDelivery(id), 'Delivery confirmed');
  }

  // ─── the partner's side ────────────────────────────────────────────────────

  @Get('driver/active')
  @ApiOperation({ summary: 'The delivery this partner is working, if any' })
  async driverActive(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<Record<string, unknown> | null>> {
    return ApiResponse.of(await this.service.driverActiveJob(user));
  }

  @Post('bookings/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Partner accepts an offered delivery (first one wins)' })
  async accept(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.acceptJob(user, id), 'Delivery accepted');
  }

  @Post('bookings/:id/driver-pickup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Partner collects the parcel with the sender's code" })
  async driverPickup(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PorterOtpDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(
      await this.service.driverPickUp(user, id, dto.otpCode),
      'Parcel collected',
    );
  }

  @Post('bookings/:id/driver-deliver')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Partner marks it delivered and becomes available again' })
  async driverDeliver(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.driverDeliver(user, id), 'Delivered');
  }
}
