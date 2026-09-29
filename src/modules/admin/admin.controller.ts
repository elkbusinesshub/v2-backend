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
import { Roles } from '@/common/decorators/roles.decorator';
import type { ServiceBookingDto } from '@/modules/home-services/home-services.dto';
import { AdminBookingsService, type DashboardDto } from './admin-bookings.service';
import { AdminCatalogService } from './admin-catalog.service';
import {
  AdminBookingsQueryDto,
  AdminLocationDto,
  AdminProfessionalDto,
  AdminPromoCodeDto,
  AdminServiceDto,
  AssignProfessionalDto,
  CreateLocationDto,
  CreateProfessionalDto,
  CreatePromoCodeDto,
  CreateServiceDto,
  SetBookingStatusDto,
  UpdateLocationDto,
  UpdateProfessionalDto,
  UpdatePromoCodeDto,
  UpdateServiceDto,
} from './admin.dto';

/**
 * Everything the admin panel calls. Every route is ADMIN only — the role is
 * given to users whose users.userType is ADMIN.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly catalog: AdminCatalogService,
    private readonly bookings: AdminBookingsService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Dashboard numbers, pending bookings and today’s jobs' })
  async dashboard(): Promise<DashboardDto> {
    return this.bookings.dashboard();
  }

  // ── services ──
  @Get('services')
  async services(): Promise<AdminServiceDto[]> {
    return this.catalog.services();
  }
  @Post('services')
  async createService(@Body() dto: CreateServiceDto): Promise<AdminServiceDto> {
    return this.catalog.createService(dto);
  }
  @Patch('services/:id')
  async updateService(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ): Promise<AdminServiceDto> {
    return this.catalog.updateService(id, dto);
  }
  @Delete('services/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteService(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.catalog.deleteService(id);
  }

  // ── locations ──
  @Get('locations')
  async locations(): Promise<AdminLocationDto[]> {
    return this.catalog.locations();
  }
  @Post('locations')
  async createLocation(@Body() dto: CreateLocationDto): Promise<AdminLocationDto> {
    return this.catalog.createLocation(dto);
  }
  @Patch('locations/:id')
  async updateLocation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
  ): Promise<AdminLocationDto> {
    return this.catalog.updateLocation(id, dto);
  }

  // ── professionals ──
  @Get('professionals')
  async professionals(): Promise<AdminProfessionalDto[]> {
    return this.catalog.professionals();
  }
  @Post('professionals')
  async createProfessional(@Body() dto: CreateProfessionalDto): Promise<AdminProfessionalDto> {
    return this.catalog.createProfessional(dto);
  }
  @Patch('professionals/:id')
  async updateProfessional(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProfessionalDto,
  ): Promise<AdminProfessionalDto> {
    return this.catalog.updateProfessional(id, dto);
  }
  @Delete('professionals/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteProfessional(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.catalog.deleteProfessional(id);
  }

  // ── promo codes ──
  @Get('promo-codes')
  async promoCodes(): Promise<AdminPromoCodeDto[]> {
    return this.catalog.promoCodes();
  }
  @Post('promo-codes')
  async createPromoCode(@Body() dto: CreatePromoCodeDto): Promise<AdminPromoCodeDto> {
    return this.catalog.createPromoCode(dto);
  }
  @Patch('promo-codes/:id')
  async updatePromoCode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromoCodeDto,
  ): Promise<AdminPromoCodeDto> {
    return this.catalog.updatePromoCode(id, dto);
  }
  @Delete('promo-codes/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deletePromoCode(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.catalog.deletePromoCode(id);
  }

  // ── bookings ──
  @Get('bookings')
  async bookingsList(@Query() query: AdminBookingsQueryDto): Promise<ServiceBookingDto[]> {
    return this.bookings.list(query.status);
  }
  @Patch('bookings/:id/assign')
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignProfessionalDto,
  ): Promise<ServiceBookingDto> {
    return this.bookings.assign(id, dto.professionalId);
  }
  @Patch('bookings/:id/status')
  async setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetBookingStatusDto,
  ): Promise<ServiceBookingDto> {
    return this.bookings.setStatus(id, dto.status);
  }
}
