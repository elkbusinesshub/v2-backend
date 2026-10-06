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
import { AdminModule, UserType } from '@prisma/client';
import { verticalsOf } from '@/common/admin-access/admin-access.service';
import { AdminModules, AdminScope } from '@/common/admin-access/admin-modules.decorator';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { Roles } from '@/common/decorators/roles.decorator';
import type { AuthUser } from '@/common/types/auth.types';
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
 * given to users whose users.userType is ADMIN. A SUPER_ADMIN has its own
 * screens: approvals (AdminApprovalsController) and users (AdminUsersController).
 *
 * The admin needs ELK Clean or ELK Repair. Services and bookings are then
 * limited to the vertical(s) they hold; areas, professionals and promo codes
 * are shared by both.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(UserType.ADMIN)
@AdminModules(AdminModule.CLEAN, AdminModule.REPAIR)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly catalog: AdminCatalogService,
    private readonly bookings: AdminBookingsService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Dashboard numbers, pending bookings and today’s jobs' })
  async dashboard(@AdminScope() scope: AdminModule[]): Promise<DashboardDto> {
    return this.bookings.dashboard(verticalsOf(scope));
  }

  // ── services ──
  @Get('services')
  async services(@AdminScope() scope: AdminModule[]): Promise<AdminServiceDto[]> {
    return this.catalog.services(verticalsOf(scope));
  }
  @Post('services')
  async createService(
    @Body() dto: CreateServiceDto,
    @CurrentUser() user: AuthUser,
    @AdminScope() scope: AdminModule[],
  ): Promise<AdminServiceDto> {
    return this.catalog.createService(dto, user.id, verticalsOf(scope));
  }
  @Patch('services/:id')
  async updateService(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
    @CurrentUser() user: AuthUser,
    @AdminScope() scope: AdminModule[],
  ): Promise<AdminServiceDto> {
    return this.catalog.updateService(id, dto, user.id, verticalsOf(scope));
  }
  @Delete('services/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteService(
    @Param('id', ParseUUIDPipe) id: string,
    @AdminScope() scope: AdminModule[],
  ): Promise<void> {
    await this.catalog.deleteService(id, verticalsOf(scope));
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
  async bookingsList(
    @Query() query: AdminBookingsQueryDto,
    @AdminScope() scope: AdminModule[],
  ): Promise<ServiceBookingDto[]> {
    return this.bookings.list(query.status, verticalsOf(scope));
  }
  @Patch('bookings/:id/assign')
  async assign(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignProfessionalDto,
    @AdminScope() scope: AdminModule[],
  ): Promise<ServiceBookingDto> {
    return this.bookings.assign(id, dto.professionalId, verticalsOf(scope));
  }
  @Patch('bookings/:id/status')
  async setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetBookingStatusDto,
    @AdminScope() scope: AdminModule[],
  ): Promise<ServiceBookingDto> {
    return this.bookings.setStatus(id, dto.status, verticalsOf(scope));
  }
}
