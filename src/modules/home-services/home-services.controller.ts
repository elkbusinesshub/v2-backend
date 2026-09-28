import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ApiResponse } from '@/common/http/api-response';
import type { AuthUser } from '@/common/types/auth.types';
import {
  CheckPromoDto,
  CreateServiceBookingDto,
  HomeServiceDto,
  PromoCheckDto,
  ServiceBookingDto,
  ServicesQueryDto,
} from './home-services.dto';
import { HomeServicesService } from './home-services.service';

@ApiTags('home-services')
@ApiBearerAuth()
@Controller()
export class HomeServicesController {
  constructor(private readonly service: HomeServicesService) {}

  @Get('services')
  @ApiOperation({ summary: 'Cleaning and repair services live in the app' })
  async list(@Query() query: ServicesQueryDto): Promise<HomeServiceDto[]> {
    return this.service.listLive(query.vertical);
  }

  @Post('promo-codes/check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'What a promo code takes off an order of this size' })
  async checkPromo(@Body() dto: CheckPromoDto): Promise<PromoCheckDto> {
    return this.service.checkPromo(dto.code, dto.subtotal);
  }

  @Post('service-bookings')
  @ApiOperation({ summary: 'Book a cleaning or repair service' })
  async book(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateServiceBookingDto,
  ): Promise<ApiResponse<ServiceBookingDto>> {
    return ApiResponse.of(await this.service.book(user, dto), 'Booking received');
  }

  @Post('service-bookings/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel your booking before the job starts' })
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiResponse<ServiceBookingDto>> {
    return ApiResponse.of(await this.service.cancel(user, id), 'Booking cancelled');
  }
}
