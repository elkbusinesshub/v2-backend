import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import {
  CreateRepairBookingDto,
  CreateRepairServiceDto,
  RepairQuoteDto,
  UpdateRepairServiceDto,
} from './repair.dto';
import { ElkRepService } from './repair.service';

/** The endpoints the app's ELK Rep shell needs to go live. */
@ApiTags('elkrep')
@ApiBearerAuth()
@Controller('elkrep')
export class ElkRepController {
  constructor(private readonly service: ElkRepService) {}

  // ─── browse ────────────────────────────────────────────────────────────────

  @Get('home')
  @ApiOperation({ summary: 'Home feed: greeting, category grid, offers' })
  async home(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>> {
    return this.service.getHomeFeed(user);
  }

  @Get('categories')
  @ApiOperation({ summary: 'Category tiles with live service counts' })
  async categories(): Promise<Record<string, unknown>[]> {
    return this.service.listCategories();
  }

  @Get('categories/:slug/services')
  @ApiOperation({ summary: 'Active services in a category' })
  async categoryServices(@Param('slug') slug: string): Promise<Record<string, unknown>[]> {
    return this.service.listCategoryServices(slug);
  }

  @Get('services/:id')
  @ApiOperation({ summary: "Service detail (price, duration, what's included)" })
  async serviceDetail(@Param('id', ParseUUIDPipe) id: string): Promise<Record<string, unknown>> {
    return this.service.getService(id);
  }

  // ─── scheduling ────────────────────────────────────────────────────────────

  @Get('booking-options')
  @ApiOperation({ summary: 'Date strip, arrival windows, fees, saved addresses' })
  async bookingOptions(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>> {
    return this.service.getBookingOptions(user);
  }

  // ─── pricing ───────────────────────────────────────────────────────────────

  /** Cart-review breakdown; identical math to booking creation, no side effects. */
  @Post('quote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Price a cart (server-side checkout formula)' })
  async quote(@Body() dto: RepairQuoteDto): Promise<Record<string, unknown>> {
    return this.service.quote(dto);
  }

  // ─── bookings ──────────────────────────────────────────────────────────────

  @Post('bookings')
  @ApiOperation({ summary: 'Book a repair (server-priced cart, mock payment)' })
  async createBooking(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateRepairBookingDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const booking = await this.service.createBooking(user, dto);
    return ApiResponse.of(booking, 'Repair booked');
  }

  @Get('bookings')
  @ApiOperation({ summary: 'My repair bookings' })
  async listBookings(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>[]> {
    return this.service.listBookings(user);
  }

  @Get('bookings/:id')
  @ApiOperation({ summary: 'Booking detail (work order)' })
  async getBooking(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, unknown>> {
    return this.service.getBooking(user, id);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Free cancellation — up to 2h before the window' })
  async cancelBooking(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<null>> {
    await this.service.cancelBooking(user, id);
    return ApiResponse.of(null, 'Booking cancelled — refund issued');
  }

  // ─── fulfilment / management (admin) ───────────────────────────────────────

  @Post('bookings/:id/complete')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark the job done → COMPLETED (ops/admin)' })
  async completeBooking(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.completeBooking(id), 'Repair completed');
  }

  @Post('services')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Add a service to the catalog (admin)' })
  async createService(
    @Body() dto: CreateRepairServiceDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.createService(dto), 'Service created');
  }

  @Patch('services/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update / deactivate a service (admin)' })
  async updateService(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRepairServiceDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return ApiResponse.of(await this.service.updateService(id, dto), 'Service updated');
  }
}
