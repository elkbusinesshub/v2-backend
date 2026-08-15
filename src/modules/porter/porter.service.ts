import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  DriverService,
  PorterBookingStatus,
  type PorterAddon,
  type PorterVehicle,
} from '@prisma/client';
import { OFFER_WINDOW_SECONDS } from '@/modules/dispatch/dispatch.constants';
import { DispatchGateway } from '@/modules/dispatch/dispatch.gateway';
import { DispatchScheduler } from '@/modules/dispatch/dispatch.queue';
import { DispatchService } from '@/modules/dispatch/dispatch.service';
import {
  DomainException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { LocationsRepository } from '@/modules/locations/locations.repository';
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

/** ₹ → paise. All money math runs on integers to avoid float drift. */
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
    private readonly locations: LocationsRepository,
    private readonly dispatch: DispatchService,
    private readonly gateway: DispatchGateway,
    private readonly scheduler: DispatchScheduler,
  ) {}

  /**
   * Who a job was offered to, so the losers can be told once it is taken.
   * In memory: it matters for seconds, and only to the instance that offered.
   */
  private readonly offered = new Map<string, string[]>();

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
   * flow's formula: fare = base + Σaddons; GST = 5% of (fare + service fee).
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
    const [pickup, drop] = await Promise.all([
      this.resolvePlace(user, dto.pickupAddressId, dto.pickupAddress, dto.pickupLat, dto.pickupLng),
      this.resolvePlace(user, dto.dropAddressId, dto.dropAddress),
    ]);
    const pickupAddress = pickup.address;
    const dropAddress = drop.address;
    const code = await this.generateCode();

    const booking = await this.bookings.create({
      booking: {
        code,
        userId: user.id,
        vehicleId: q.vehicle.id,
        // No partner yet: the job goes out to whoever is nearby, and belongs
        // to the first one who takes it.
        status: PorterBookingStatus.SEARCHING,
        pickupAddress,
        dropAddress,
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

    this.gateway.joinTrip(user.id, booking.id);

    if (pickup.lat === null || pickup.lng === null) {
      // Nothing to search around; say so now rather than after a minute of
      // waiting on a search that could never match anybody.
      await this.bookings.markNoDrivers(booking.id);
      this.logger.warn(`porter ${code} has no pickup coordinate — cannot dispatch`);
      return toPorterBookingJson((await this.bookings.findById(booking.id))!);
    }

    const offered = await this.dispatch.offer(
      DriverService.PORTER,
      { lat: pickup.lat, lng: pickup.lng },
      q.vehicle.slug,
      {
        bookingId: booking.id,
        code,
        pickupAddress,
        dropAddress,
        fare: q.totalAmount,
        distanceKm: PORTER_DEFAULT_DISTANCE_KM,
      },
      OFFER_WINDOW_SECONDS,
    );
    this.offered.set(booking.id, offered);
    await this.scheduler.scheduleExpiry(booking.id, DriverService.PORTER);

    this.logger.log(`porter ${code} searching: offered to ${offered.length} partner(s)`);
    return toPorterBookingJson((await this.bookings.findById(booking.id))!);
  }

  // ─── the partner's side ────────────────────────────────────────────────────

  /** A partner takes the job. First one through wins. */
  async acceptJob(user: AuthUser, id: string): Promise<Record<string, unknown>> {
    const requested = await this.bookings.findById(id);
    if (!requested) {
      throw new ResourceNotFoundException('Booking');
    }
    if (requested.userId === user.id) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'CANNOT_DELIVER_YOURSELF',
        'You cannot accept your own delivery',
      );
    }

    const driver = await this.dispatch.claim(user, DriverService.PORTER, id);
    const assigned = await this.bookings.assignDriver(id, {
      driverId: driver.id,
      driverName: driver.user.name ?? 'ELK partner',
      vehicleLabel: driver.vehicleLabel,
      plateNumber: driver.plateNumber,
      otpCode: this.dispatch.pickupOtp(),
    });
    if (!assigned) {
      await this.dispatch.release(driver.id);
      throw new DomainException(
        HttpStatus.CONFLICT,
        'JOB_ALREADY_TAKEN',
        'Another partner accepted this delivery first',
      );
    }

    const booking = (await this.bookings.findById(id))!;
    this.gateway.emitTrip(id, 'trip:accepted', {
      driverName: booking.driverName,
      vehicleLabel: booking.vehicleLabel,
      plateNumber: booking.plateNumber,
      otpCode: booking.otpCode,
      etaMinutes: booking.etaMinutes,
    });
    this.dispatch.closeOffers(this.offered.get(id) ?? [], id);
    this.offered.delete(id);

    this.logger.log(`porter ${booking.code} accepted by driver=${driver.id}`);
    return toPorterBookingJson(booking);
  }

  /** The job this partner is working — what their app opens onto. */
  async driverActiveJob(user: AuthUser): Promise<Record<string, unknown> | null> {
    const profile = await this.dispatch.profileFor(user, DriverService.PORTER);
    const booking = await this.bookings.findForDriver(profile.id);
    return booking ? toPorterBookingJson(booking) : null;
  }

  /** Collected, against the code the sender shows — proof the partner is there. */
  async driverPickUp(
    user: AuthUser,
    id: string,
    otpCode: string,
  ): Promise<Record<string, unknown>> {
    const profile = await this.dispatch.profileFor(user, DriverService.PORTER);
    const booking = await this.assertDriverBooking(profile.id, id);
    if (booking.otpCode !== otpCode) {
      throw new ValidationFailedException([{ field: 'otpCode', message: 'Incorrect OTP' }]);
    }
    const ok = await this.bookings.pickUpByDriver(id, profile.id);
    if (!ok) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        'Pickup can only be confirmed for an accepted delivery',
      );
    }
    this.gateway.emitTrip(id, 'trip:picked_up', {});
    this.logger.log(`porter picked up by partner: ${booking.code}`);
    return toPorterBookingJson((await this.bookings.findById(id))!);
  }

  /** Delivered — and the partner is available again. */
  async driverDeliver(user: AuthUser, id: string): Promise<Record<string, unknown>> {
    const profile = await this.dispatch.profileFor(user, DriverService.PORTER);
    const booking = await this.assertDriverBooking(profile.id, id);
    const ok = await this.bookings.deliverByDriver(id, profile.id);
    if (!ok) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        'Delivery can only be confirmed once the parcel has been collected',
      );
    }
    await this.dispatch.release(profile.id);
    this.gateway.emitTrip(id, 'trip:delivered', {});
    this.logger.log(`porter delivered by partner: ${booking.code}`);
    return toPorterBookingJson((await this.bookings.findById(id))!);
  }

  /**
   * A saved address (looked up scoped to the caller — a mismatched owner
   * behaves like "not found") takes priority over freeform text, which covers
   * the map-pick and current-location options that carry no saved address id.
   *
   * The coordinate comes back alongside it: dispatch needs somewhere to search
   * around, and a saved address was pinned on a map when it was saved.
   */
  private async resolvePlace(
    user: AuthUser,
    addressId: string | undefined,
    freeText: string | undefined,
    lat?: number,
    lng?: number,
  ): Promise<{ address: string; lat: number | null; lng: number | null }> {
    if (!addressId) {
      return { address: freeText!, lat: lat ?? null, lng: lng ?? null };
    }
    const address = await this.locations.findByIdForUser(addressId, user.id);
    if (!address) {
      throw new ResourceNotFoundException('Address');
    }
    return { address: address.formattedAddress, lat: address.lat, lng: address.lng };
  }

  private async assertDriverBooking(driverId: string, id: string) {
    const booking = await this.bookings.findById(id);
    if (!booking || booking.driverId !== driverId) {
      throw new ResourceNotFoundException('Booking');
    }
    return booking;
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
    await this.dispatch.release(booking.driverId);
    this.gateway.emitTrip(id, 'trip:cancelled', {});
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
