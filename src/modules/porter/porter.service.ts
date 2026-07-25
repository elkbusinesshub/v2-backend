import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PorterBookingStatus, type PorterAddon, type PorterVehicle } from '@prisma/client';
import {
  DomainException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import {
  PORTER_CODE_ALPHABET,
  PORTER_CODE_MIN,
  PORTER_CODE_SPAN,
  PORTER_DEFAULT_DISTANCE_KM,
  PORTER_DEFAULT_ROUTE,
  PORTER_PICKUP_WINDOWS,
  PORTER_SCHEDULE_MAX_DAYS,
  PORTER_SERVICE_FEE,
  PORTER_UTC_OFFSET,
  PORTER_VAT_RATE,
} from './porter.constants';
import type { CreatePorterBookingDto, PorterQuoteDto } from './porter.dto';
import { toAddonJson, toPorterBookingJson, toVehicleJson } from './porter.mapper';
import { PorterBookingsRepository } from './porter-bookings.repository';
import { PorterCatalogRepository } from './porter-catalog.repository';

/** Milliseconds the operating region is ahead of UTC (from PORTER_UTC_OFFSET). */
const OFFSET_MS = -new Date(`1970-01-01T00:00:00${PORTER_UTC_OFFSET}`).getTime();
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** AED → fils. All money math runs on integers to avoid float drift. */
const fils = (aed: number): number => Math.round(aed * 100);

/** Fully resolved and validated quote — the single pricing source of truth. */
interface ResolvedQuote {
  vehicle: PorterVehicle;
  addons: PorterAddon[];
  baseFare: number;
  addonsTotal: number;
  serviceFee: number;
  vatAmount: number;
  totalAmount: number;
}

@Injectable()
export class PorterService {
  private readonly logger = new Logger(PorterService.name);

  constructor(
    private readonly catalog: PorterCatalogRepository,
    private readonly bookings: PorterBookingsRepository,
  ) {}

  // ─── options (the exact payload the app's repository already fetches) ──────

  async getOptions(): Promise<Record<string, unknown>> {
    const [vehicles, addons] = await Promise.all([
      this.catalog.listActiveVehicles(),
      this.catalog.listActiveAddons(),
    ]);
    const first = vehicles[0];
    return {
      vehicles: vehicles.map(toVehicleJson),
      addons: addons.map(toAddonJson),
      pickupWindows: PORTER_PICKUP_WINDOWS.map((w) => w.label),
      serviceFee: PORTER_SERVICE_FEE,
      vatRate: PORTER_VAT_RATE,
      // legacy PorterRouteModel card — static estimate until the maps layer
      route: {
        ...PORTER_DEFAULT_ROUTE,
        estimatedFare: first ? Number(first.baseFare) : 0,
        distanceKm: PORTER_DEFAULT_DISTANCE_KM,
        etaMinutes: first?.etaMinutes ?? 0,
      },
    };
  }

  // ─── pricing (the checkout formula, computed server-side only) ─────────────

  async quote(dto: PorterQuoteDto): Promise<Record<string, unknown>> {
    return this.quoteJson(await this.resolveQuote(dto));
  }

  /**
   * Validates vehicle + add-ons against the catalog and applies the booking
   * flow's formula: fare = base + Σaddons; VAT = 5% of (fare + service fee).
   */
  private async resolveQuote(dto: PorterQuoteDto): Promise<ResolvedQuote> {
    const vehicle = await this.catalog.findActiveVehicleBySlug(dto.vehicleId);
    if (!vehicle) {
      throw new ValidationFailedException([{ field: 'vehicleId', message: 'Unknown vehicle' }]);
    }

    const requested = dto.addons ?? [];
    const addons = await this.catalog.findActiveAddonsByKeys(requested);
    if (addons.length !== requested.length) {
      const known = new Set(addons.map((a) => a.key));
      const bad = requested.filter((k) => !known.has(k)).join(', ');
      throw new ValidationFailedException([
        { field: 'addons', message: `Unknown add-ons: ${bad}` },
      ]);
    }

    const baseFareFils = fils(Number(vehicle.baseFare));
    const addonsTotalFils = addons.reduce((sum, a) => sum + fils(Number(a.price)), 0);
    const serviceFeeFils = fils(PORTER_SERVICE_FEE);
    const vatFils = Math.round((baseFareFils + addonsTotalFils + serviceFeeFils) * PORTER_VAT_RATE);

    return {
      vehicle,
      addons,
      baseFare: baseFareFils / 100,
      addonsTotal: addonsTotalFils / 100,
      serviceFee: serviceFeeFils / 100,
      vatAmount: vatFils / 100,
      totalAmount: (baseFareFils + addonsTotalFils + serviceFeeFils + vatFils) / 100,
    };
  }

  // ─── bookings ──────────────────────────────────────────────────────────────

  async createBooking(
    user: AuthUser,
    dto: CreatePorterBookingDto,
  ): Promise<Record<string, unknown>> {
    const schedule = this.resolveSchedule(dto);
    const q = await this.resolveQuote(dto);
    const code = await this.generateCode();

    const booking = await this.bookings.create({
      booking: {
        code,
        userId: user.id,
        vehicleId: q.vehicle.id,
        status: PorterBookingStatus.CONFIRMED,
        pickupAddress: dto.pickupAddress,
        dropAddress: dto.dropAddress,
        packageType: dto.packageType ?? null,
        weightLabel: dto.weightLabel ?? null,
        scheduledAt: schedule.scheduledAt,
        pickupWindow: schedule.pickupWindow,
        distanceKm: PORTER_DEFAULT_DISTANCE_KM,
        etaMinutes: q.vehicle.etaMinutes,
        baseFare: q.baseFare,
        addonsTotal: q.addonsTotal,
        serviceFee: q.serviceFee,
        vatAmount: q.vatAmount,
        totalAmount: q.totalAmount,
        paymentMethod: dto.paymentMethod,
        // internal mock charge — replaced by the payments module later
        paymentRef: `PAY-${code}`,
        paidAt: new Date(),
      },
      addons: q.addons.map((a) => ({ addonId: a.id, label: a.label, price: Number(a.price) })),
    });

    this.logger.log(`porter booking created: ${code} user=${user.id} vehicle=${q.vehicle.slug}`);
    return toPorterBookingJson(booking);
  }

  async listBookings(user: AuthUser): Promise<Record<string, unknown>[]> {
    return (await this.bookings.listForUser(user.id)).map(toPorterBookingJson);
  }

  async getBooking(user: AuthUser, id: string): Promise<Record<string, unknown>> {
    const booking = await this.bookings.findForUser(id, user.id);
    if (!booking) {
      throw new ResourceNotFoundException('Booking');
    }
    return toPorterBookingJson(booking);
  }

  /** Free cancellation — only while CONFIRMED (before the rider picks up). */
  async cancelBooking(user: AuthUser, id: string): Promise<void> {
    const booking = await this.bookings.findForUser(id, user.id);
    if (!booking) {
      throw new ResourceNotFoundException('Booking');
    }
    const cancelled = await this.bookings.cancel(id, user.id);
    if (!cancelled) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'NOT_CANCELLABLE',
        'Deliveries can only be cancelled before pickup',
      );
    }
    this.logger.log(`porter booking cancelled (mock refund): ${booking.code}`);
  }

  // ─── fulfilment (ops/admin until rider assignment exists) ──────────────────

  async confirmPickup(id: string): Promise<Record<string, unknown>> {
    const booking = await this.assertBookingExists(id);
    const ok = await this.bookings.markPickedUp(id);
    if (!ok) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        'Pickup can only be confirmed for a confirmed booking',
      );
    }
    this.logger.log(`porter picked up: ${booking.code}`);
    return toPorterBookingJson((await this.bookings.findById(id))!);
  }

  async confirmDelivery(id: string): Promise<Record<string, unknown>> {
    const booking = await this.assertBookingExists(id);
    const ok = await this.bookings.markDelivered(id);
    if (!ok) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        'Delivery can only be confirmed for a picked-up booking',
      );
    }
    this.logger.log(`porter delivered: ${booking.code}`);
    return toPorterBookingJson((await this.bookings.findById(id))!);
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  private async assertBookingExists(id: string) {
    const booking = await this.bookings.findById(id);
    if (!booking) {
      throw new ResourceNotFoundException('Booking');
    }
    return booking;
  }

  /**
   * "Pick up now" (no fields) → ASAP, scheduledAt null. "Schedule for later"
   * → date within 30 days and a window that hasn't already started.
   */
  private resolveSchedule(dto: CreatePorterBookingDto): {
    scheduledAt: Date | null;
    pickupWindow: string | null;
  } {
    if (dto.scheduledDate === undefined && dto.pickupWindow === undefined) {
      return { scheduledAt: null, pickupWindow: null };
    }
    const window = PORTER_PICKUP_WINDOWS.find((w) => w.label === dto.pickupWindow);
    if (!window) {
      throw new ValidationFailedException([
        { field: 'pickupWindow', message: 'Unknown pickup window' },
      ]);
    }

    const todayRegion = new Date(Date.now() + OFFSET_MS).toISOString().slice(0, 10);
    const lastDay = new Date(Date.now() + OFFSET_MS + PORTER_SCHEDULE_MAX_DAYS * MS_PER_DAY)
      .toISOString()
      .slice(0, 10);
    if (dto.scheduledDate! < todayRegion || dto.scheduledDate! > lastDay) {
      throw new ValidationFailedException([
        { field: 'scheduledDate', message: 'Date is outside the booking window' },
      ]);
    }

    const scheduledAt = new Date(`${dto.scheduledDate}T${window.start}:00.000${PORTER_UTC_OFFSET}`);
    if (scheduledAt.getTime() <= Date.now()) {
      throw new ValidationFailedException([
        { field: 'pickupWindow', message: 'That pickup window has already passed' },
      ]);
    }
    return { scheduledAt, pickupWindow: window.label };
  }

  private quoteJson(q: ResolvedQuote): Record<string, unknown> {
    return {
      vehicle: toVehicleJson(q.vehicle),
      addons: q.addons.map(toAddonJson),
      distanceKm: PORTER_DEFAULT_DISTANCE_KM,
      etaMinutes: q.vehicle.etaMinutes,
      breakdown: {
        baseFare: q.baseFare,
        addonsTotal: q.addonsTotal,
        serviceFee: q.serviceFee,
        vatAmount: q.vatAmount,
        totalAmount: q.totalAmount,
      },
    };
  }

  private async generateCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const letters =
        PORTER_CODE_ALPHABET[randomInt(PORTER_CODE_ALPHABET.length)]! +
        PORTER_CODE_ALPHABET[randomInt(PORTER_CODE_ALPHABET.length)]!;
      const code = `ELK-${PORTER_CODE_MIN + randomInt(PORTER_CODE_SPAN)}-${letters}`;
      if (!(await this.bookings.codeExists(code))) {
        return code;
      }
    }
    return `ELK-${Date.now()}`;
  }
}
