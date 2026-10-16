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
import {
  AdminBookingsService,
  type AdminBookingDto,
  type DashboardDto,
} from './admin-bookings.service';
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

  @Get('me')
  @ApiOperation({ summary: 'The modules this admin runs: CLEAN, REPAIR, RENTAL' })
  me(@AdminScope() scope: AdminModule[]): { modules: AdminModule[] } {
    return { modules: [...scope].sort() };
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Dashboard numbers, pending bookings and today’s jobs' })
  async dashboard(
    @CurrentUser() user: AuthUser,
    @AdminScope() scope: AdminModule[],
  ): Promise<DashboardDto> {
    return this.bookings.dashboard(user.id, verticalsOf(scope));
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

  // ── locations ── (the company's own service areas)
  @Get('locations')
  async locations(@CurrentUser() user: AuthUser): Promise<AdminLocationDto[]> {
    return this.catalog.locations(user.id);
  }
  @Post('locations')
  async createLocation(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateLocationDto,
  ): Promise<AdminLocationDto> {
    return this.catalog.createLocation(user.id, dto);
  }
  @Patch('locations/:id')
  async updateLocation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLocationDto,
  ): Promise<AdminLocationDto> {
    return this.catalog.updateLocation(user.id, id, dto);
  }

  // ── professionals ── (the company's own people)
  @Get('professionals')
  @ApiOperation({ summary: 'The company’s professionals, with their approval status' })
  async professionals(@CurrentUser() user: AuthUser): Promise<AdminProfessionalDto[]> {
    return this.catalog.professionals(user.id);
  }
  @Post('professionals')
  @ApiOperation({ summary: 'Add a professional; they wait for the super admin’s approval' })
  async createProfessional(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProfessionalDto,
    @AdminScope() scope: AdminModule[],
  ): Promise<AdminProfessionalDto> {
    return this.catalog.createProfessional(user.id, dto, verticalsOf(scope));
  }
  @Patch('professionals/:id')
  async updateProfessional(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProfessionalDto,
    @AdminScope() scope: AdminModule[],
  ): Promise<AdminProfessionalDto> {
    return this.catalog.updateProfessional(user.id, id, dto, verticalsOf(scope));
  }
  @Delete('professionals/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteProfessional(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.catalog.deleteProfessional(user.id, id);
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
    @CurrentUser() user: AuthUser,
    @Query() query: AdminBookingsQueryDto,
    @AdminScope() scope: AdminModule[],
  ): Promise<AdminBookingDto[]> {
    return this.bookings.list(user.id, query.status, verticalsOf(scope));
  }
  @Get('bookings/:id/professionals')
  @ApiOperation({ summary: 'The company’s approved professionals who do this booking’s service' })
  async assignable(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @AdminScope() scope: AdminModule[],
  ): Promise<AdminProfessionalDto[]> {
    return this.catalog.assignableFor(user.id, id, verticalsOf(scope));
  }
  @Patch('bookings/:id/assign')
  @ApiOperation({ summary: 'Assign and confirm; the professional is sent the job on WhatsApp' })
  async assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignProfessionalDto,
    @AdminScope() scope: AdminModule[],
  ): Promise<AdminBookingDto> {
    return this.bookings.assign(user.id, id, dto.professionalId, verticalsOf(scope));
  }
  @Post('bookings/:id/whatsapp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send the job to the assigned professional on WhatsApp again' })
  async resendWhatsapp(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @AdminScope() scope: AdminModule[],
  ): Promise<AdminBookingDto> {
    return this.bookings.resend(user.id, id, verticalsOf(scope));
  }
  @Patch('bookings/:id/status')
  async setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetBookingStatusDto,
    @AdminScope() scope: AdminModule[],
  ): Promise<AdminBookingDto> {
    return this.bookings.setStatus(user.id, id, dto.status, verticalsOf(scope));
  }
}
