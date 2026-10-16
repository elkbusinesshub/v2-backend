import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  ProfessionalStatus,
  ServiceVertical,
  type HomeService,
  type PromoCode,
  type ServiceLocation,
} from '@prisma/client';
import {
  DomainException,
  DuplicateResourceException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import { isoDay } from '@/modules/home-services/home-services.mapper';
import { HomeServicesRepository } from '@/modules/home-services/home-services.repository';
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
  PendingChangeDto,
  PromoState,
  UpdateLocationDto,
  UpdateProfessionalDto,
  UpdatePromoCodeDto,
  UpdateServiceDto,
} from './admin.dto';
import { assertVertical } from './admin-scope';
import { AdminRepository, type ProfessionalRow } from './admin.repository';
import { ServiceChangeRepository, type OpenChange } from './service-change.repository';
import { PRICE_FIELDS, priceOf, samePrice, startingPrice, termsOf } from './service-terms';

/**
 * The catalogue side of the admin panel: services and their prices, service
 * areas, the professionals, and promo codes.
 *
 * Changes go live as soon as they are saved, except a new service and a
 * service's price or duration: those wait for the super admin (see
 * AdminApprovalsService), and the app keeps what it has until then.
 */
@Injectable()
export class AdminCatalogService {
  private readonly logger = new Logger(AdminCatalogService.name);

  constructor(
    private readonly repo: AdminRepository,
    private readonly changes: ServiceChangeRepository,
    private readonly places: PlacesService,
    private readonly bookings: HomeServicesRepository,
  ) {}

  // ── services ──────────────────────────────────────────────────────────────

  async services(verticals: ServiceVertical[]): Promise<AdminServiceDto[]> {
    const [all, open, changes] = await Promise.all([
      this.repo.services(),
      this.repo.openBookingsByService(),
      this.changes.openChanges(),
    ]);
    return all
      .filter((s) => verticals.includes(s.vertical))
      .map((s) => this.serviceJson(s, open.get(s.id) ?? 0, changes.get(s.id)));
  }

  /** Saves the service hidden from the app, and asks the super admin to approve it. */
  async createService(
    dto: CreateServiceDto,
    requestedById: string,
    verticals: ServiceVertical[],
  ): Promise<AdminServiceDto> {
    assertVertical(dto.vertical, verticals);
    this.checkCategory(dto.vertical, dto.category);
    const active = dto.active ?? true;
    const { service, change } = await this.changes.transaction(async (tx) => {
      const service = await this.repo.createService(
        {
          ...dto,
          active,
          // Offline follows inactive: a service nobody offers cannot be shown.
          online: active && (dto.online ?? true),
          approved: false,
        },
        tx,
      );
      return { service, change: await this.changes.requestNewService(service, requestedById, tx) };
    });
    return this.serviceJson(service, 0, change);
  }

  /**
   * Name, description, tile and the on/off switches save straight away. A new
   * price or duration becomes a request, replacing any already waiting; asking
   * for what is live again withdraws it. A service still waiting to be
   * approved is not in the app, so everything about it saves straight away.
   */
  async updateService(
    id: string,
    dto: UpdateServiceDto,
    requestedById: string,
    verticals: ServiceVertical[],
  ): Promise<AdminServiceDto> {
    const current = await this.repo.service(id);
    if (!current) throw new ResourceNotFoundException('Service');
    assertVertical(current.vertical, verticals);
    if (dto.vertical) assertVertical(dto.vertical, verticals);
    this.checkCategory(dto.vertical ?? current.vertical, dto.category ?? current.category);

    const { minHours, hourlyRate, extraProRate, materialsFee, ...rest } = dto;
    const priceAsked = PRICE_FIELDS.some((f) => dto[f] !== undefined);
    const direct = current.approved ? rest : dto;
    const active = dto.active ?? current.active;
    const [updated, open, waiting] = await Promise.all([
      this.repo.updateService(id, {
        ...direct,
        active,
        online: active && (dto.online ?? current.online),
      }),
      this.repo.openBookingsByService(),
      this.changes.openChange(id),
    ]);

    let change = waiting;
    if (current.approved && priceAsked) {
      const live = priceOf(termsOf(updated));
      const wanted = {
        ...(waiting?.requested ?? live),
        ...this.defined({ minHours, hourlyRate, extraProRate, materialsFee }),
      };
      if (samePrice(wanted, live)) {
        await this.changes.withdraw(id);
        change = null;
      } else {
        change = await this.changes.requestPriceChange(updated, wanted, requestedById);
      }
    }
    return this.serviceJson(updated, open.get(id) ?? 0, change);
  }

  async deleteService(id: string, verticals: ServiceVertical[]): Promise<void> {
    const service = await this.repo.service(id);
    if (!service) throw new ResourceNotFoundException('Service');
    assertVertical(service.vertical, verticals);
    // Bookings keep their snapshot of the name and price and still go ahead.
    await this.repo.deleteService(id);
  }

  private defined<T extends object>(o: T): Partial<T> {
    return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
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

  private serviceJson(
    s: HomeService,
    openBookings: number,
    change?: OpenChange | null,
  ): AdminServiceDto {
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
      approved: s.approved,
      live: s.approved && s.active && s.online,
      pendingChange: change ? this.pendingJson(s, change) : null,
      openBookings,
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  private pendingJson(s: HomeService, c: OpenChange): PendingChangeDto {
    // A new service is its own request: what it holds now is what is asked for.
    const price = c.kind === 'NEW_SERVICE' ? priceOf(termsOf(s)) : c.requested;
    return {
      id: c.id,
      kind: c.kind,
      ...price,
      startingPrice: startingPrice(price),
      requestedAt: c.createdAt.toISOString(),
    };
  }

  // ── locations ─────────────────────────────────────────────────────────────
  // Each company has its own areas; a booking goes to the company whose area
  // covers the customer's address.

  async locations(companyId: string): Promise<AdminLocationDto[]> {
    const [locations, pending] = await Promise.all([
      this.repo.locations(companyId),
      this.repo.pendingByLocation(companyId),
    ]);
    return locations.map((l) => this.locationJson(l, pending.get(l.id) ?? 0));
  }

  async createLocation(companyId: string, dto: CreateLocationDto): Promise<AdminLocationDto> {
    const centre = await this.geocode(dto.area, dto.district, dto.pincode);
    const created = await this.repo.createLocation({
      ...dto,
      companyId,
      active: dto.active ?? true,
      lat: centre?.lat ?? null,
      lng: centre?.lng ?? null,
    });
    return this.locationJson(created, 0);
  }

  async updateLocation(
    companyId: string,
    id: string,
    dto: UpdateLocationDto,
  ): Promise<AdminLocationDto> {
    const current = await this.repo.location(id, companyId);
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
    const pending = await this.repo.pendingByLocation(companyId);
    return this.locationJson(updated, pending.get(id) ?? 0);
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

  private locationJson(l: ServiceLocation, pending: number): AdminLocationDto {
    return {
      id: l.id,
      area: l.area,
      district: l.district,
      pincode: l.pincode,
      radiusKm: l.radiusKm,
      mapped: l.lat !== null && l.lng !== null,
      active: l.active,
      pendingBookings: pending,
    };
  }

  // ── professionals ─────────────────────────────────────────────────────────
  // A company's own people. New ones, and ones whose phone or email changes,
  // wait for the super admin before they can be assigned.

  async professionals(companyId: string): Promise<AdminProfessionalDto[]> {
    const [pros, onJob, today] = await Promise.all([
      this.repo.professionals(companyId),
      this.repo.professionalsOnJob(companyId),
      this.repo.jobsOnDay(companyId, new Date(`${todayInIndia()}T00:00:00.000Z`)),
    ]);
    return pros.map((p) => this.professionalJson(p, onJob.has(p.id), today.get(p.id) ?? 0));
  }

  /** The approved professionals who can take a booking, for its Assign list. */
  async assignableFor(
    companyId: string,
    bookingId: string,
    verticals: ServiceVertical[],
  ): Promise<AdminProfessionalDto[]> {
    const booking = await this.bookings.findBooking(bookingId);
    if (!booking || booking.companyId !== companyId) throw new ResourceNotFoundException('Booking');
    assertVertical(booking.vertical, verticals);
    return this.assignable(companyId, booking.category);
  }

  private async assignable(companyId: string, category: string): Promise<AdminProfessionalDto[]> {
    const [pros, onJob, today] = await Promise.all([
      this.repo.approvedFor(companyId, category),
      this.repo.professionalsOnJob(companyId),
      this.repo.jobsOnDay(companyId, new Date(`${todayInIndia()}T00:00:00.000Z`)),
    ]);
    return pros.map((p) => this.professionalJson(p, onJob.has(p.id), today.get(p.id) ?? 0));
  }

  async createProfessional(
    companyId: string,
    dto: CreateProfessionalDto,
    verticals: ServiceVertical[],
  ): Promise<AdminProfessionalDto> {
    const categories = this.checkCategories(dto.categories, verticals);
    const created = await this.repo.createProfessional(
      {
        companyId,
        name: dto.name.trim(),
        phone: toE164(dto.phone),
        email: dto.email.trim().toLowerCase(),
        experienceYears: dto.experienceYears ?? 0,
      },
      categories,
    );
    this.logger.log(`professional added, waiting for approval: ${created.id} by ${companyId}`);
    return this.professionalJson(created, false, 0);
  }

  /**
   * Name, experience and categories save straight away. A new phone or email
   * sends an approved professional back for approval, since job messages go to
   * them; any edit to a rejected one sends it back too, so it can be fixed.
   */
  async updateProfessional(
    companyId: string,
    id: string,
    dto: UpdateProfessionalDto,
    verticals: ServiceVertical[],
  ): Promise<AdminProfessionalDto> {
    const current = await this.repo.professional(id, companyId);
    if (!current) throw new ResourceNotFoundException('Professional');
    const categories = dto.categories && this.checkCategories(dto.categories, verticals);

    const phone = dto.phone === undefined ? undefined : toE164(dto.phone);
    const email = dto.email === undefined ? undefined : dto.email.trim().toLowerCase();
    const contactChanged =
      (phone !== undefined && phone !== current.phone) ||
      (email !== undefined && email !== current.email);
    const resubmit =
      current.status === ProfessionalStatus.REJECTED ||
      (current.status === ProfessionalStatus.APPROVED && contactChanged);

    const updated = await this.repo.updateProfessional(
      id,
      {
        name: dto.name?.trim(),
        phone,
        email,
        experienceYears: dto.experienceYears,
        ...(resubmit
          ? { status: ProfessionalStatus.PENDING, decidedById: null, decidedAt: null, note: '' }
          : {}),
      },
      categories,
    );
    const [onJob, today] = await Promise.all([
      this.repo.professionalsOnJob(companyId),
      this.repo.jobsOnDay(companyId, new Date(`${todayInIndia()}T00:00:00.000Z`)),
    ]);
    return this.professionalJson(updated, onJob.has(id), today.get(id) ?? 0);
  }

  async deleteProfessional(companyId: string, id: string): Promise<void> {
    const pro = await this.repo.professional(id, companyId);
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

  /** Categories must be service tiles of the verticals the admin runs. */
  private checkCategories(categories: string[], verticals: ServiceVertical[]): string[] {
    const allowed = new Set(verticals.flatMap((v) => SERVICE_CATEGORIES[v]));
    const unknown = categories.filter((c) => !allowed.has(c));
    if (unknown.length > 0) {
      throw new ValidationFailedException([
        { field: 'categories', message: `Not a category you run: ${unknown.join(', ')}` },
      ]);
    }
    return [...new Set(categories)];
  }

  private professionalJson(
    p: ProfessionalRow,
    onJob: boolean,
    jobsToday: number,
  ): AdminProfessionalDto {
    return {
      id: p.id,
      name: p.name,
      phone: p.phone,
      email: p.email,
      experienceYears: p.experienceYears,
      categories: p.categories.map((c) => c.category).sort(),
      status: p.status,
      note: p.note,
      activity: onJob ? 'ON_JOB' : 'AVAILABLE',
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

/** "+91 98765 43210" or "9876543210" → "+919876543210". 10 digits are Indian. */
export function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `+91${digits}` : `+${digits}`;
}
