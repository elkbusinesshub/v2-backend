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
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import {
  CreateRideBookingDto,
  RateRideDto,
  RideRequestPreviewDto,
  StartRideDto,
} from './rides.dto';
import { RidesService } from './rides.service';

/**
 * `/rides/types`, `/rides/current-estimate` and `/rides/request` are the
 * exact paths `RideRepository` already calls; `/rides/bookings/...` is what
 * `ride_booking_flow.dart`'s full trip lifecycle needs to go live.
 */
@ApiTags('rides')
@ApiBearerAuth()
@Controller('rides')
export class RidesController {
  constructor(private readonly service: RidesService) {}

  @Get('types')
  @ApiOperation({ summary: 'Ride classes (Auto / Economy / Premium / ELK XL)' })
  async types(): Promise<Record<string, unknown>[]> {
    return this.service.listRideTypes();
  }

  @Get('current-estimate')
  @ApiOperation({ summary: 'Static route estimate for the map header' })
  currentEstimate(): Record<string, unknown> {
    return this.service.getCurrentEstimate();
  }

  @Post('request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Driver-match preview — no booking is created' })
  async request(@Body() dto: RideRequestPreviewDto): Promise<Record<string, unknown>> {
    return this.service.previewDriverMatch(dto);
  }

  @Post('bookings')
  @ApiOperation({ summary: 'Book a ride (driver assigned + OTP issued, mock payment)' })
  async createBooking(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRideBookingDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const booking = await this.service.createBooking(user, dto);
    return ApiResponse.of(booking, 'Ride booked');
  }

  @Get('bookings')
  @ApiOperation({ summary: 'My rides' })
  async listBookings(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>[]> {
    return this.service.listBookings(user);
  }

  @Get('bookings/:id')
  @ApiOperation({ summary: 'Ride detail (driver, OTP, breakdown)' })
  async getBooking(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, unknown>> {
    return this.service.getBooking(user, id);
  }

  @Post('bookings/:id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start the trip — rider confirms the pickup OTP' })
  async startRide(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartRideDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.startRide(user, id, dto), 'Trip started');
  }

  @Post('bookings/:id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete the trip on arrival' })
  async completeRide(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.completeRide(user, id), 'Trip completed');
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Free cancellation — before the trip starts' })
  async cancelBooking(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<null>> {
    await this.service.cancelBooking(user, id);
    return ApiResponse.of(null, 'Ride cancelled');
  }

  @Post('bookings/:id/rate')
  @ApiOperation({ summary: 'Rate the driver and add an optional tip' })
  async rateRide(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RateRideDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(
      await this.service.rateRide(user, id, dto),
      'Thanks for rating your ride',
    );
  }
}
