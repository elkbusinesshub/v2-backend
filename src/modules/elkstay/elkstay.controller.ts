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
  CreateStayBookingDto,
  CreateStayDto,
  ListStaysQuery,
  ScheduleVisitDto,
  UpdateStayDto,
  VerifyStayDto,
} from './elkstay.dto';
import { ElkStayService } from './elkstay.service';

/**
 * Routes mirror the paths the Flutter repository calls (`/elkstay/home`,
 * `/elkstay/stays`, `/elkstay/stay/:id`, `/elkstay/bookings`) so wiring the
 * app means swapping `simulate()` for `dio.get()` — nothing else.
 */
@ApiTags('elkstay')
@ApiBearerAuth()
@Controller('elkstay')
export class ElkStayController {
  constructor(private readonly service: ElkStayService) {}

  // ─── browse ────────────────────────────────────────────────────────────────

  /** Home feed: greeting, category cards with live counts, top rated stays. */
  @Get('home')
  @ApiOperation({ summary: 'ELK Stay home feed' })
  async home(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>> {
    return this.service.getHomeFeed(user);
  }

  /** Listings with the explore screen's filter chips as query params. */
  @Get('stays')
  @ApiOperation({ summary: 'List/search stays with filters and pagination' })
  async list(@Query() query: ListStaysQuery): Promise<ApiResponse<Record<string, unknown>[]>> {
    const { items, meta } = await this.service.listStays(query);
    return ApiResponse.of(items, 'OK', meta);
  }

  @Get('stay/:id')
  @ApiOperation({ summary: 'Stay detail with amenities, room options and saved flag' })
  async detail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, unknown>> {
    return this.service.getStayDetail(user, id);
  }

  // ─── favorites ─────────────────────────────────────────────────────────────

  @Post('stay/:id/favorite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save a stay (idempotent)' })
  async favorite(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<null>> {
    await this.service.addFavorite(user, id);
    return ApiResponse.of(null, 'Saved');
  }

  @Delete('stay/:id/favorite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unsave a stay' })
  async unfavorite(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<null>> {
    await this.service.removeFavorite(user, id);
    return ApiResponse.of(null, 'Removed');
  }

  @Get('favorites')
  @ApiOperation({ summary: 'My saved stays' })
  async favorites(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>[]> {
    return this.service.listFavorites(user);
  }

  // ─── bookings ──────────────────────────────────────────────────────────────

  /** My stays screen — Active / Requests / Past tabs filter client-side. */
  @Get('bookings')
  @ApiOperation({ summary: 'My stay bookings and visit requests' })
  async bookings(@CurrentUser() user: AuthUser): Promise<Record<string, unknown>[]> {
    return this.service.listBookings(user);
  }

  /** "Request to book" flow: server-side pricing + internal mock payment. */
  @Post('bookings')
  @ApiOperation({ summary: 'Create a stay booking (computes price breakdown server-side)' })
  async createBooking(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateStayBookingDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const booking = await this.service.createBooking(user, dto);
    return ApiResponse.of(booking, 'Booking confirmed');
  }

  /** "Schedule visit" flow — appears under the Requests tab. */
  @Post('visits')
  @ApiOperation({ summary: 'Schedule a property visit' })
  async scheduleVisit(
    @CurrentUser() user: AuthUser,
    @Body() dto: ScheduleVisitDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const visit = await this.service.scheduleVisit(user, dto);
    return ApiResponse.of(visit, 'Visit scheduled');
  }

  @Post('bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a pending request or scheduled visit' })
  async cancelBooking(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<null>> {
    await this.service.cancelBooking(user, id);
    return ApiResponse.of(null, 'Booking cancelled');
  }

  // ─── management: providers own their stays, admin approves ────────────────

  @Post('stays')
  @Roles(Role.PROVIDER)
  @ApiOperation({ summary: 'Create a stay listing (provider)' })
  async createStay(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateStayDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const stay = await this.service.createStay(user, dto);
    return ApiResponse.of(stay, 'Stay created');
  }

  @Patch('stays/:id')
  @Roles(Role.PROVIDER, Role.ADMIN)
  @ApiOperation({ summary: 'Update own stay listing (provider/admin)' })
  async updateStay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStayDto,
  ): Promise<ApiResponse<Record<string, unknown>>> {
    const stay = await this.service.updateStay(user, id, dto);
    return ApiResponse.of(stay, 'Stay updated');
  }

  @Delete('stays/:id')
  @Roles(Role.PROVIDER, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete own stay listing (provider/admin)' })
  async deleteStay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<null>> {
    await this.service.deleteStay(user, id);
    return ApiResponse.of(null, 'Stay deleted');
  }

  /** Approval workflow: only admins grant/revoke the Verified badge. */
  @Patch('stays/:id/verify')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Approve or revoke stay verification (admin)' })
  async verifyStay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyStayDto,
  ): Promise<ApiResponse<null>> {
    await this.service.setVerified(id, dto.isVerified);
    return ApiResponse.of(null, dto.isVerified ? 'Stay verified' : 'Verification revoked');
  }
}
