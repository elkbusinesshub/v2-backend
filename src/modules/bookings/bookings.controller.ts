import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { BookingConfirmationDto, BookingListItemDto, CreateBookingDto } from './bookings.dto';
import { BookingsService } from './bookings.service';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Post()
  @ApiOperation({ summary: 'Book a service slot' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateBookingDto,
  ): Promise<ApiResponse<BookingConfirmationDto>> {
    const confirmation = await this.bookingsService.create(user.id, dto);
    return ApiResponse.of(confirmation, 'Booking confirmed');
  }

  @Get()
  @ApiOperation({ summary: "List the current user's bookings, newest first" })
  async list(@CurrentUser() user: AuthUser): Promise<ApiResponse<BookingListItemDto[]>> {
    return ApiResponse.of(await this.bookingsService.list(user.id));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel an upcoming booking' })
  async cancel(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<ApiResponse<null>> {
    await this.bookingsService.cancel(user.id, id);
    return ApiResponse.of(null, 'Booking cancelled');
  }

  @Post(':id/complete')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark the job done → COMPLETED (ops/admin)' })
  async complete(@Param('id') id: string): Promise<ApiResponse<null>> {
    await this.bookingsService.complete(id);
    return ApiResponse.of(null, 'Booking completed');
  }
}
