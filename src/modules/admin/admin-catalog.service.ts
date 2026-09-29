import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma, type HomeService, type PromoCode, type ServiceLocation } from '@prisma/client';
import {
  DomainException,
  DuplicateResourceException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import { isoDay } from '@/modules/home-services/home-services.mapper';
import { SERVICE_CATEGORIES, todayInIndia } from '@/modules/home-services/home-services.rules';
import { PlacesService } from '@/modules/places/places.service';
import type {
  AdminLocationDto,
  AdminProfessionalDto,
  AdminPromoCodeDto,
  AdminServiceDto,
  CreateLocationDto,
  CreateProfessionalDto,
  CreatePromoCodeDto,
  CreateServiceDto,
  ProfessionalStatus,
  PromoState,
  UpdateLocationDto,
  UpdateProfessionalDto,
  UpdatePromoCodeDto,
  UpdateServiceDto,
} from './admin.dto';
import { AdminRepository, type ProfessionalRow } from './admin.repository';

/**
 * The catalogue side of the admin panel: services and their prices, service
 * areas, the professionals, and promo codes.
 *
 * Changes go live as soon as they are saved. A super-admin approval step is
 * planned; when it lands, saves here become requests instead.
 */
@Injectable()
export class AdminCatalogService {
  private readonly logger = new Logger(AdminCatalogService.name);

  constructor(
    private readonly repo: AdminRepository,
    private readonly places: PlacesService,
  ) {}

  // ── services ──────────────────────────────────────────────────────────────

  async services(): Promise<AdminServiceDto[]> {
    const [services, open] = await Promise.all([
      this.repo.services(),
      this.repo.openBookingsByService(),
    ]);
    return services.map((s) => this.serviceJson(s, open.get(s.id) ?? 0));
  }

  async createService(dto: CreateServiceDto): Promise<AdminServiceDto> {
    this.checkCategory(dto.vertical, dto.category);
    const active = dto.active ?? true;
    const created = await this.repo.createService({
      ...dto,
      active,
      // Offline follows inactive: a service nobody offers cannot be shown.
      online: active && (dto.online ?? true),
    });
    return this.serviceJson(created, 0);
  }

  async updateService(id: string, dto: UpdateServiceDto): Promise<AdminServiceDto> {
    const current = await this.repo.service(id);
    if (!current) throw new ResourceNotFoundException('Service');
    this.checkCategory(dto.vertical ?? current.vertical, dto.category ?? current.category);
    const active = dto.active ?? current.active;
    const updated = await this.repo.updateService(id, {
      ...dto,
      active,
      online: active && (dto.online ?? current.online),
    });
    const open = await this.repo.openBookingsByService();
    return this.serviceJson(updated, open.get(id) ?? 0);
  }

  async deleteService(id: string): Promise<void> {
    if (!(await this.repo.service(id))) throw new ResourceNotFoundException('Service');
    // Bookings keep their snapshot of the name and price and still go ahead.
    await this.repo.deleteService(id);
  }

  private checkCategory(vertical: HomeService['vertical'], category: string): void {
    if (!SERVICE_CATEGORIES[vertical].includes(category)) {
      throw new ValidationFailedException([
        {
          field: 'category',
          message: `category must be one of ${SERVICE_CATEGORIES[vertical].join(', ')}`,
        },
      ]);
    }
  }

  private serviceJson(s: HomeService, openBookings: number): AdminServiceDto {
    const hourlyRate = Number(s.hourlyRate);
    return {
      id: s.id,
      vertical: s.vertical,
      category: s.category,
      name: s.name,
      description: s.description,
      minHours: s.minHours,
      hourlyRate,
      extraProRate: Number(s.extraProRate),
      materialsFee: Number(s.materialsFee),
      fromPrice: hourlyRate * s.minHours,
      active: s.active,
      online: s.online,
      live: s.active && s.online,
      openBookings,
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  // ── locations ─────────────────────────────────────────────────────────────

  async locations(): Promise<AdminLocationDto[]> {
    const [locations, pros, pending] = await Promise.all([
      this.repo.locations(),
      this.repo.professionalsByLocation(),
      this.repo.pendingByLocation(),
    ]);
    return locations.map((l) => this.locationJson(l, pros.get(l.id) ?? 0, pending.get(l.id) ?? 0));
  }

  async createLocation(dto: CreateLocationDto): Promise<AdminLocationDto> {
    const centre = await this.geocode(dto.area, dto.district, dto.pincode);
    const created = await this.repo.createLocation({
      ...dto,
      active: dto.active ?? true,
      lat: centre?.lat ?? null,
      lng: centre?.lng ?? null,
    });
    return this.locationJson(created, 0, 0);
  }

  async updateLocation(id: string, dto: UpdateLocationDto): Promise<AdminLocationDto> {
    const current = await this.repo.location(id);
    if (!current) throw new ResourceNotFoundException('Location');
    const moved =
      (dto.area !== undefined && dto.area !== current.area) ||
      (dto.district !== undefined && dto.district !== current.district) ||
      (dto.pincode !== undefined && dto.pincode !== current.pincode);
    // Re-find the centre only when the place itself changed, or it was never found.
    const centre =
      moved || current.lat === null
        ? await this.geocode(
            dto.area ?? current.area,
            dto.district ?? current.district,
            dto.pincode ?? current.pincode,
          )
        : { lat: current.lat, lng: current.lng! };
    const updated = await this.repo.updateLocation(id, {
      ...dto,
      lat: centre?.lat ?? null,
      lng: centre?.lng ?? null,
    });
    const [pros, pending] = await Promise.all([
      this.repo.professionalsByLocation(),
      this.repo.pendingByLocation(),
    ]);
    return this.locationJson(updated, pros.get(id) ?? 0, pending.get(id) ?? 0);
  }

  /**
   * The centre of an area, from Google. Null when it cannot be found — the
   * area then matches bookings by pincode alone, which is still useful.
   */
  private async geocode(
    area: string,
    district: string,
    pincode: string,
  ): Promise<{ lat: number; lng: number } | null> {
    try {
      const [first] = await this.places.search(`${area}, ${district} ${pincode}, India`);
      if (!first) return null;
      const place = await this.places.details(first.placeId);
      return { lat: place.lat, lng: place.lng };
    } catch (err) {
      this.logger.warn({ err, area, district, pincode }, 'could not find the centre of an area');
      return null;
    }
  }

  private locationJson(l: ServiceLocation, pros: number, pending: number): AdminLocationDto {
    return {
      id: l.id,
      area: l.area,
      district: l.district,
      pincode: l.pincode,
      radiusKm: l.radiusKm,
      mapped: l.lat !== null && l.lng !== null,
      active: l.active,
      professionals: pros,
      pendingBookings: pending,
    };
  }

  // ── professionals ─────────────────────────────────────────────────────────

  async professionals(): Promise<AdminProfessionalDto[]> {
    const [pros, onJob, today] = await Promise.all([
      this.repo.professionals(),
      this.repo.professionalsOnJob(),
      this.repo.jobsOnDay(new Date(`${todayInIndia()}T00:00:00.000Z`)),
    ]);
    return pros.map((p) => this.professionalJson(p, onJob.has(p.id), today.get(p.id) ?? 0));
  }

  async createProfessional(dto: CreateProfessionalDto): Promise<AdminProfessionalDto> {
    await this.checkLocation(dto.locationId);
    const created = await this.repo.createProfessional(
      { ...dto, locationId: dto.locationId ?? null, onDuty: dto.onDuty ?? true },
      accountPhone(dto.phone),
    );
    if (created === 'PHONE_TAKEN') throw phoneTaken();
    return this.professionalJson(created, false, 0);
  }

  async updateProfessional(id: string, dto: UpdateProfessionalDto): Promise<AdminProfessionalDto> {
    if (!(await this.repo.professional(id))) throw new ResourceNotFoundException('Professional');
    await this.checkLocation(dto.locationId);
    const updated = await this.repo.updateProfessional(
      id,
      dto,
      dto.phone === undefined ? undefined : accountPhone(dto.phone),
    );
    if (updated === 'PHONE_TAKEN') throw phoneTaken();
    const [onJob, today] = await Promise.all([
      this.repo.professionalsOnJob(),
      this.repo.jobsOnDay(new Date(`${todayInIndia()}T00:00:00.000Z`)),
    ]);
    return this.professionalJson(updated, onJob.has(id), today.get(id) ?? 0);
  }

  async deleteProfessional(id: string): Promise<void> {
    const pro = await this.repo.professional(id);
    if (!pro) throw new ResourceNotFoundException('Professional');
    if (await this.repo.hasActiveAssignments(id)) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'HAS_ASSIGNMENTS',
        `Reassign ${pro.name}'s upcoming bookings before removing them`,
      );
    }
    await this.repo.deleteProfessional(id);
  }

  private async checkLocation(locationId: string | null | undefined): Promise<void> {
    if (locationId && !(await this.repo.location(locationId))) {
      throw new ResourceNotFoundException('Location');
    }
  }

  private professionalJson(
    p: ProfessionalRow,
    onJob: boolean,
    jobsToday: number,
  ): AdminProfessionalDto {
    const status: ProfessionalStatus = !p.onDuty ? 'OFF_DUTY' : onJob ? 'ON_JOB' : 'AVAILABLE';
    return {
      id: p.id,
      name: p.name,
      phone: p.phone,
      experienceYears: p.experienceYears,
      skills: p.skills,
      location: p.location,
      onDuty: p.onDuty,
      status,
      jobsToday,
    };
  }

  // ── promo codes ───────────────────────────────────────────────────────────

  async promoCodes(): Promise<AdminPromoCodeDto[]> {
    return (await this.repo.promoCodes()).map((p) => this.promoJson(p));
  }

  async createPromoCode(dto: CreatePromoCodeDto): Promise<AdminPromoCodeDto> {
    const code = dto.code.toUpperCase();
    this.checkValidTill(dto.validTill);
    if (await this.repo.promoCodeByCode(code)) {
      throw new DuplicateResourceException(`${code} already exists`);
    }
    const created = await this.repo.createPromoCode({
      ...dto,
      code,
      validTill: new Date(`${dto.validTill}T00:00:00.000Z`),
      active: dto.active ?? true,
      description: dto.description ?? '',
    });
    return this.promoJson(created);
  }

  async updatePromoCode(id: string, dto: UpdatePromoCodeDto): Promise<AdminPromoCodeDto> {
    const current = await this.repo.promoCode(id);
    if (!current) throw new ResourceNotFoundException('Promo code');
    const code = dto.code?.toUpperCase();
    if (code && code !== current.code && (await this.repo.promoCodeByCode(code))) {
      throw new DuplicateResourceException(`${code} already exists`);
    }
    if (dto.validTill) this.checkValidTill(dto.validTill);
    if (dto.active && !dto.validTill && isoDay(current.validTill) < todayInIndia()) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'PROMO_EXPIRED',
        `${current.code} has expired. Change the valid-till date to switch it back on.`,
      );
    }
    const data: Prisma.PromoCodeUpdateInput = {
      ...dto,
      ...(code ? { code } : {}),
      ...(dto.validTill ? { validTill: new Date(`${dto.validTill}T00:00:00.000Z`) } : {}),
    };
    return this.promoJson(await this.repo.updatePromoCode(id, data));
  }

  async deletePromoCode(id: string): Promise<void> {
    if (!(await this.repo.promoCode(id))) throw new ResourceNotFoundException('Promo code');
    await this.repo.deletePromoCode(id);
  }

  private checkValidTill(validTill: string): void {
    if (validTill < todayInIndia()) {
      throw new ValidationFailedException([
        { field: 'validTill', message: 'validTill must be today or later' },
      ]);
    }
  }

  private promoJson(p: PromoCode): AdminPromoCodeDto {
    const validTill = isoDay(p.validTill);
    const state: PromoState =
      validTill < todayInIndia() ? 'EXPIRED' : p.active ? 'ACTIVE' : 'INACTIVE';
    return {
      id: p.id,
      code: p.code,
      percent: p.percent,
      maxDiscount: Number(p.maxDiscount),
      minOrder: Number(p.minOrder),
      validTill,
      active: p.active,
      state,
      description: p.description,
    };
  }
}

/** "+91 98765 43210" (as the panel stores it) → "+919876543210", the account's phone. */
export function accountPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `+91${digits}` : `+${digits}`;
}

function phoneTaken(): DomainException {
  return new DomainException(
    HttpStatus.CONFLICT,
    'CONFLICT',
    'Another professional already uses this phone number',
  );
}
