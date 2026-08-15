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
import { CreateRideBookingDto, DriverOtpDto, RateRideDto, StartRideDto } from './rides.dto';
import { RidesService } from './rides.service';

/**
 * The rider's side of taxi: the catalogue, the route estimate, and the trip
 * lifecycle. The partner's side is at the bottom; who is on duty and where
 * lives in the dispatch module.
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

  @Post('bookings')
  @ApiOperation({ summary: 'Request a ride — goes out to nearby partners (mock payment)' })
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

  // ─── the partner's side ────────────────────────────────────────────────────

  @Get('driver/active')
  @ApiOperation({ summary: 'The trip this partner is working, if any' })
  async driverActive(
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<Record<string, unknown> | null>> {
    return ApiResponse.of(await this.service.driverActiveTrip(user));
  }

  @Post('bookings/:id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Partner accepts an offered trip (first one wins)' })
  async accept(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.acceptRide(user, id), 'Trip accepted');
  }

  @Post('bookings/:id/driver-start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Partner starts the trip with the rider's code" })
  async driverStart(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DriverOtpDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.driverStart(user, id, dto.otpCode), 'Trip started');
  }

  @Post('bookings/:id/driver-complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Partner ends the trip and becomes available again' })
  async driverComplete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.driverComplete(user, id), 'Trip completed');
  }
}
