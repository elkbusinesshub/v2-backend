import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { BookingListItemDto } from './bookings.dto';
import { BookingsService } from './bookings.service';

/**
 * `GET /bookings` — the "My Bookings" list.
 *
 * Read-only: a booking is created by whichever vertical owns it (an order
 * against a listing, or a cleaning or repair booking), and cancelled through
 * that same vertical's endpoint, because each enforces its own rules.
 */
@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  @ApiOperation({ summary: "List the current user's bookings, newest first" })
  async list(@CurrentUser() user: AuthUser): Promise<ApiResponse<BookingListItemDto[]>> {
    return ApiResponse.of(await this.bookingsService.list(user.id));
  }
}
