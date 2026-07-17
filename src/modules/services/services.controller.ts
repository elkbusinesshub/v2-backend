import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import { BookingOptionsDto, ServiceDetailDto, ServiceGroupDto } from './services.dto';
import { ServicesService } from './services.service';

@ApiTags('services')
@ApiBearerAuth()
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  @ApiOperation({ summary: 'Catalog grouped by category' })
  async list(): Promise<ApiResponse<ServiceGroupDto[]>> {
    return ApiResponse.of(await this.servicesService.listGroups());
  }

  @Get(':id')
  @ApiOperation({ summary: 'Full detail for one service' })
  async detail(@Param('id') id: string): Promise<ApiResponse<ServiceDetailDto>> {
    return ApiResponse.of(await this.servicesService.getDetail(id));
  }

  @Get(':id/booking-options')
  @ApiOperation({ summary: 'Dates, time slots, prefilled address, and pricing for booking' })
  async bookingOptions(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ApiResponse<BookingOptionsDto>> {
    return ApiResponse.of(await this.servicesService.getBookingOptions(id, user.id));
  }
}
