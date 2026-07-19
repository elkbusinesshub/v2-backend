import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import {
  AvailabilityQuery,
  CreateRentalBookingDto,
  CreateRentalCarDto,
  ListCarsQuery,
  RentalQuoteDto,
  UpdateRentalCarDto,
} from './rentals.dto';
import { RentalsService } from './rentals.service';

/**
 * `/rentals/cars` is the exact path the Flutter repository already calls;
 * the rest are the endpoints its 5-step booking flow needs to go live.
 */
@ApiTags('rentals')
@ApiBearerAuth()
@Controller('rentals')
export class RentalsController {
  constructor(private readonly service: RentalsService) {}

  // ─── catalog ───────────────────────────────────────────────────────────────

  @Get('cars')
  @ApiOperation({ summary: 'List cars (category filter, price sort, pagination)' })
  async listCars(@Query() query: ListCarsQuery): Promise<ApiResponse<Record<string, unknown>[]>> {
    const { items, meta } = await this.service.listCars(query);
    return ApiResponse.of(items, 'OK', meta);
  }

  @Get('cars/:id/availability')
  @ApiOperation({ summary: 'Check whether a car is free for a period' })
  async availability(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AvailabilityQuery,
  ): Promise<{ available: boolean }> {
    return this.service.checkAvailability(id, query.from, query.to);
  }

  @Get('branches')
  @ApiOperation({ summary: 'Self-pickup branch locations' })
  async branches(): Promise<Record<string, unknown>[]> {
    return this.service.listBranches();
  }

  @Get('extras')
  @ApiOperation({ summary: 'Extras & protection catalog (priced per day)' })
  async extras(): Promise<Record<string, unknown>[]> {
    return this.service.listExtras();
  }

  // ─── pricing ───────────────────────────────────────────────────────────────

  /** Review-step breakdown; identical math to booking creation, no side effects. */
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Price a rental (server-side checkout formula)' })
  async quote(@Body() dto: RentalQuoteDto): Promise<Record<string, unknown>> {
    return this.service.quote(dto);
  }

  // ─── bookings ──────────────────────────────────────────────────────────────

  @Post('bookings')
  @ApiOperation({ summary: 'Create a rental booking (availability-checked, mock payment)' })
  async createBooking(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRentalBookingDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const booking = await this.service.createBooking(user, dto);
    return ApiResponse.of(booking, 'Booking confirmed');
  }

  @Get('bookings')
  @ApiOperation({ summary: 'My rental history' })
  async listBookings(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>[]> {
    return this.service.listBookings(user);
  }

  @Get('bookings/:id')
  @ApiOperation({ summary: 'Booking detail (success ticket)' })
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

  // ─── fulfilment (car provider / admin) ─────────────────────────────────────

  @Post('bookings/:id/pickup')
  @Roles(Role.PROVIDER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm vehicle handover → rental becomes ACTIVE' })
  async confirmPickup(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.confirmPickup(actor, id), 'Pickup confirmed');
  }

  @Post('bookings/:id/return')
  @Roles(Role.PROVIDER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm return → COMPLETED, late fee applied if overdue' })
  async confirmReturn(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.confirmReturn(actor, id), 'Return confirmed');
  }

  // ─── management (provider/admin) ───────────────────────────────────────────

  @Post('cars')
  @Roles(Role.PROVIDER)
  @ApiOperation({ summary: 'Add a car (provider)' })
  async createCar(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRentalCarDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.createCar(user, dto), 'Car created');
  }

  @Patch('cars/:id')
  @Roles(Role.PROVIDER, Role.ADMIN)
  @ApiOperation({ summary: 'Update own car (provider/admin)' })
  async updateCar(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRentalCarDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.updateCar(user, id, dto), 'Car updated');
  }

  @Delete('cars/:id')
  @Roles(Role.PROVIDER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete own car (provider/admin)' })
  async deleteCar(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<null>> {
    await this.service.deleteCar(user, id);
    return ApiResponse.of(null, 'Car deleted');
  }
}
