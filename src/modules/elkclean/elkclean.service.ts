import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  CleanBookingStatus,
  CleanPromoKind,
  type CleanService as CleanServiceRow,
} from '@prisma/client';
import {
  DomainException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { LocationsRepository } from '@/modules/locations/locations.repository';
import { UsersRepository } from '@/modules/users/users.repository';
import {
  CLEAN_BOOKABLE_DAYS,
  CLEAN_CANCEL_CUTOFF_HOURS,
  CLEAN_CODE_MIN,
  CLEAN_CODE_SPAN,
  CLEAN_DEFAULT_LOCATION,
  CLEAN_SUPPLY_FEE,
  CLEAN_TIME_SLOTS,
  CLEAN_UTC_OFFSET,
} from './elkclean.constants';
import type {
  CleanQuoteDto,
  CreateCleanBookingDto,
  CreateCleanServiceDto,
  UpdateCleanServiceDto,
} from './elkclean.dto';
import { toCategoryJson, toCleanBookingJson, toOfferJson, toServiceJson } from './elkclean.mapper';
import { CleanBookingsRepository } from './clean-bookings.repository';
import { CleanCatalogRepository } from './clean-catalog.repository';

/** Milliseconds the operating region is ahead of UTC (from CLEAN_UTC_OFFSET). */
const OFFSET_MS = -new Date(`1970-01-01T00:00:00${CLEAN_UTC_OFFSET}`).getTime();
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Fully resolved and validated cart — the single pricing source of truth. */
interface ResolvedQuote {
  lines: { service: CleanServiceRow; quantity: number; lineTotal: number }[];
  subtotal: number;
  supplyFee: number;
  promoCode: string | null;
  discountAmount: number;
  totalAmount: number;
}

@Injectable()
export class ElkCleanService {
  private readonly logger = new Logger(ElkCleanService.name);

  constructor(
    private readonly catalog: CleanCatalogRepository,
    private readonly bookings: CleanBookingsRepository,
    private readonly users: UsersRepository,
    private readonly locations: LocationsRepository,
  ) {}

  // ─── browse ────────────────────────────────────────────────────────────────

  async getHomeFeed(user: AuthUser): Promise<Record<string, unknown>> {
    const [account, categories, counts, offers] = await Promise.all([
      this.users.findById(user.id),
      this.catalog.listCategories(),
      this.catalog.activeServiceCounts(),
      this.catalog.listActiveOffers(),
    ]);
    return {
      userName: firstName(account?.name ?? 'there'),
      location: CLEAN_DEFAULT_LOCATION,
      categories: categories.map((c) => toCategoryJson(c, { serviceCount: counts[c.id] ?? 0 })),
      offers: offers.map(toOfferJson),
    };
  }

  async listCategories(): Promise<Record<string, unknown>[]> {
    const [categories, counts] = await Promise.all([
      this.catalog.listCategories(),
      this.catalog.activeServiceCounts(),
    ]);
    return categories.map((c) => toCategoryJson(c, { serviceCount: counts[c.id] ?? 0 }));
  }

  async listCategoryServices(slug: string): Promise<Record<string, unknown>[]> {
    const category = await this.catalog.findCategoryBySlug(slug);
    if (!category) {
      throw new ResourceNotFoundException('Category');
    }
    const services = await this.catalog.listServicesByCategory(category.id);
    return services.map(toServiceJson);
  }

  async getService(id: string): Promise<Record<string, unknown>> {
    const service = await this.catalog.findServiceById(id);
    if (!service || !service.isActive) {
      throw new ResourceNotFoundException('Service');
    }
    return toServiceJson(service);
  }

  // ─── scheduling ────────────────────────────────────────────────────────────

  /** The 6-day strip + arrival windows + saved addresses, all in one call. */
  async getBookingOptions(user: AuthUser): Promise<Record<string, unknown>> {
    const addresses = await this.locations.findAllByUser(user.id);
    return {
      dates: this.upcomingDates(),
      timeSlots: [...CLEAN_TIME_SLOTS],
      supplyFee: CLEAN_SUPPLY_FEE,
      addresses: addresses.map((a) => ({
        id: a.id,
        label: a.label,
        line: a.formattedAddress,
        isDefault: a.isDefault,
      })),
    };
  }

  // ─── pricing (the checkout formula, computed server-side only) ─────────────

  async quote(dto: CleanQuoteDto): Promise<Record<string, unknown>> {
    return this.quoteJson(await this.resolveQuote(dto));
  }

  /**
   * Validates every cart line against the catalog and applies the app's
   * formula: subtotal = Σ price×qty; total = subtotal − discount + supply fee.
   * (No VAT on cleans today — the app shows none.)
   */
  private async resolveQuote(dto: CleanQuoteDto): Promise<ResolvedQuote> {
    const ids = dto.items.map((l) => l.serviceId);
    const services = await this.catalog.findActiveServicesByIds(ids);
    if (services.length !== ids.length) {
      const known = new Set(services.map((s) => s.id));
      const bad = ids.filter((id) => !known.has(id)).join(', ');
      throw new ValidationFailedException([
        { field: 'items', message: `Unknown or inactive services: ${bad}` },
      ]);
    }

    const byId = new Map(services.map((s) => [s.id, s]));
    const lines = dto.items.map((l) => {
      const service = byId.get(l.serviceId)!;
      return { service, quantity: l.quantity, lineTotal: service.price * l.quantity };
    });
    const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);

    let promoCode: string | null = null;
    let discountAmount = 0;
    if (dto.promoCode) {
      const promo = await this.catalog.findActivePromo(dto.promoCode.trim().toUpperCase());
      if (!promo) {
        throw new ValidationFailedException([
          { field: 'promoCode', message: "That code isn't valid" },
        ]);
      }
      promoCode = promo.code;
      discountAmount =
        promo.kind === CleanPromoKind.PERCENT
          ? Math.round((subtotal * promo.value) / 100)
          : Math.min(promo.value, subtotal);
    }

    return {
      lines,
      subtotal,
      supplyFee: CLEAN_SUPPLY_FEE,
      promoCode,
      discountAmount,
      totalAmount: subtotal - discountAmount + CLEAN_SUPPLY_FEE,
    };
  }

  // ─── bookings ──────────────────────────────────────────────────────────────

  async createBooking(
    user: AuthUser,
    dto: CreateCleanBookingDto,
  ): Promise<Record<string, unknown>> {
    const scheduledAt = this.resolveSlot(dto.scheduledDate, dto.timeSlot);

    const address = await this.locations.findByIdForUser(dto.addressId, user.id);
    if (!address) {
      throw new ResourceNotFoundException('Address');
    }

    const q = await this.resolveQuote(dto);
    const code = await this.generateCode();

    const booking = await this.bookings.create({
      booking: {
        code,
        userId: user.id,
        status: CleanBookingStatus.CONFIRMED,
        scheduledDate: new Date(`${dto.scheduledDate}T00:00:00.000Z`),
        timeSlot: dto.timeSlot,
        scheduledAt,
        addressLabel: address.label,
        addressText: address.formattedAddress,
        subtotal: q.subtotal,
        supplyFee: q.supplyFee,
        promoCode: q.promoCode,
        discountAmount: q.discountAmount,
        totalAmount: q.totalAmount,
        paymentMethod: dto.paymentMethod,
        // internal mock charge — replaced by the payments module later
        paymentRef: `PAY-${code}`,
        paidAt: new Date(),
      },
      items: q.lines.map((l) => ({
        serviceId: l.service.id,
        name: l.service.name,
        unitPrice: l.service.price,
        quantity: l.quantity,
        lineTotal: l.lineTotal,
      })),
    });

    this.logger.log(`clean booking created: ${code} user=${user.id} lines=${q.lines.length}`);
    return toCleanBookingJson(booking);
  }

  async listBookings(user: AuthUser): Promise<Record<string, unknown>[]> {
    return (await this.bookings.listForUser(user.id)).map(toCleanBookingJson);
  }

  async getBooking(user: AuthUser, id: string): Promise<Record<string, unknown>> {
    const booking = await this.bookings.findForUser(id, user.id);
    if (!booking) {
      throw new ResourceNotFoundException('Booking');
    }
    return toCleanBookingJson(booking);
  }

  /** Free cancellation — only while CONFIRMED and >2h before the slot. */
  async cancelBooking(user: AuthUser, id: string): Promise<void> {
    const booking = await this.bookings.findForUser(id, user.id);
    if (!booking) {
      throw new ResourceNotFoundException('Booking');
    }
    const cutoff = new Date(Date.now() + CLEAN_CANCEL_CUTOFF_HOURS * 60 * 60 * 1000);
    const cancelled = await this.bookings.cancel(id, user.id, cutoff);
    if (!cancelled) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'NOT_CANCELLABLE',
        `Cleans can only be cancelled up to ${CLEAN_CANCEL_CUTOFF_HOURS}h before the arrival window`,
      );
    }
    this.logger.log(`clean booking cancelled (mock refund): ${booking.code}`);
  }

  /** Ops marks the crew's job done (admin-only until crew assignment exists). */
  async completeBooking(id: string): Promise<Record<string, unknown>> {
    const booking = await this.bookings.findById(id);
    if (!booking) {
      throw new ResourceNotFoundException('Booking');
    }
    const ok = await this.bookings.markCompleted(id);
    if (!ok) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        'Only a confirmed booking can be completed',
      );
    }
    this.logger.log(`clean booking completed: ${booking.code}`);
    return toCleanBookingJson((await this.bookings.findById(id))!);
  }

  // ─── management (admin) ────────────────────────────────────────────────────

  async createService(dto: CreateCleanServiceDto): Promise<Record<string, unknown>> {
    const category = await this.catalog.findCategoryBySlug(dto.categorySlug);
    if (!category) {
      throw new ValidationFailedException([{ field: 'categorySlug', message: 'Unknown category' }]);
    }
    const code = await this.nextServiceCode(category.code, category.id);
    const service = await this.catalog.createService({
      code,
      categoryId: category.id,
      name: dto.name,
      description: dto.description,
      price: dto.price,
      durationLabel: dto.durationLabel,
      tag: dto.tag ?? null,
      checklist: dto.checklist,
      steps: dto.steps ?? undefined,
    });
    return toServiceJson(service);
  }

  async updateService(id: string, dto: UpdateCleanServiceDto): Promise<Record<string, unknown>> {
    const existing = await this.catalog.findServiceById(id);
    if (!existing) {
      throw new ResourceNotFoundException('Service');
    }
    const { categorySlug, ...rest } = dto;
    let categoryId: string | undefined;
    if (categorySlug) {
      const category = await this.catalog.findCategoryBySlug(categorySlug);
      if (!category) {
        throw new ValidationFailedException([
          { field: 'categorySlug', message: 'Unknown category' },
        ]);
      }
      categoryId = category.id;
    }
    const service = await this.catalog.updateService(id, { ...rest, categoryId });
    return toServiceJson(service);
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  /** The app's 6-day strip, in the operating region's calendar. */
  private upcomingDates(): Record<string, unknown>[] {
    const now = Date.now();
    return Array.from({ length: CLEAN_BOOKABLE_DAYS }, (_, i) => {
      const local = new Date(now + OFFSET_MS + i * MS_PER_DAY);
      return {
        date: local.toISOString().slice(0, 10),
        day: local.getUTCDate(),
        weekday: i === 0 ? 'TODAY' : WEEKDAYS[local.getUTCDay()]!,
      };
    });
  }

  /** Validates date-in-window + slot-not-passed; returns the slot instant. */
  private resolveSlot(date: string, slot: string): Date {
    const window = new Set(this.upcomingDates().map((d) => d.date as string));
    if (!window.has(date)) {
      throw new ValidationFailedException([
        { field: 'scheduledDate', message: 'Date is outside the booking window' },
      ]);
    }
    const scheduledAt = new Date(`${date}T${slot}:00.000${CLEAN_UTC_OFFSET}`);
    if (scheduledAt.getTime() <= Date.now()) {
      throw new ValidationFailedException([
        { field: 'timeSlot', message: 'That arrival window has already passed' },
      ]);
    }
    return scheduledAt;
  }

  private async generateCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `ELC-${CLEAN_CODE_MIN + randomInt(CLEAN_CODE_SPAN)}`;
      if (!(await this.bookings.codeExists(code))) {
        return code;
      }
    }
    return `ELC-${Date.now()}`;
  }

  /** Next "PFX-NN" SKU in the category, e.g. TNK-04. */
  private async nextServiceCode(prefix: string, categoryId: string): Promise<string> {
    const existing = await this.catalog.listServicesByCategory(categoryId);
    for (let n = existing.length + 1; n < existing.length + 20; n++) {
      const code = `${prefix}-${String(n).padStart(2, '0')}`;
      if (!(await this.catalog.findServiceByCode(code))) {
        return code;
      }
    }
    return `${prefix}-${Date.now()}`;
  }

  private quoteJson(q: ResolvedQuote): Record<string, unknown> {
    return {
      items: q.lines.map((l) => ({
        serviceId: l.service.id,
        code: l.service.code,
        name: l.service.name,
        unitPrice: l.service.price,
        quantity: l.quantity,
        lineTotal: l.lineTotal,
      })),
      breakdown: {
        subtotal: q.subtotal,
        supplyFee: q.supplyFee,
        promoCode: q.promoCode,
        discountAmount: q.discountAmount,
        totalAmount: q.totalAmount,
      },
    };
  }
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
