import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  Role,
  RentalBookingStatus,
  RentalFulfilment,
  type RentalBranch,
  type RentalCar,
  type RentalExtra,
  type RentalType,
} from '@prisma/client';
import {
  DomainException,
  ForbiddenResourceException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import { paginationMeta, type PaginationMeta } from '@/common/http/pagination';
import type { AuthUser } from '@/common/types/auth.types';
import {
  CAR_CATEGORY_ID_TO_ENUM,
  RENTAL_CODE_MIN,
  RENTAL_CODE_SPAN,
  RENTAL_DELIVERY_FEE,
  RENTAL_RATE_MULTIPLIER,
  RENTAL_TYPE_ID_TO_ENUM,
  RENTAL_VAT_RATE,
} from './rentals.constants';
import type {
  CreateRentalBookingDto,
  CreateRentalCarDto,
  ListCarsQuery,
  RentalQuoteDto,
  UpdateRentalCarDto,
} from './rentals.dto';
import { toBranchJson, toCarJson, toExtraJson, toRentalBookingJson } from './rentals.mapper';
import { RentalBookingsRepository } from './rental-bookings.repository';
import { RentalCarsRepository } from './rental-cars.repository';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Fully resolved and validated quote — the single pricing source of truth. */
interface ResolvedQuote {
  car: RentalCar;
  rentalType: RentalType;
  pickupAt: Date;
  returnAt: Date;
  fulfilment: RentalFulfilment;
  branch: RentalBranch | null;
  extras: RentalExtra[];
  days: number;
  dailyRate: number;
  rentalTotal: number;
  deliveryFee: number;
  extrasTotal: number;
  subtotal: number;
  promoCode: string | null;
  promoDiscount: number;
  vatAmount: number;
  totalAmount: number;
}

@Injectable()
export class RentalsService {
  private readonly logger = new Logger(RentalsService.name);

  constructor(
    private readonly cars: RentalCarsRepository,
    private readonly bookings: RentalBookingsRepository,
  ) {}

  // ─── catalog ───────────────────────────────────────────────────────────────

  async listCars(
    query: ListCarsQuery,
  ): Promise<{ items: Record<string, unknown>[]; meta: PaginationMeta }> {
    const category =
      query.category && query.category !== 'all'
        ? CAR_CATEGORY_ID_TO_ENUM[query.category]
        : undefined;
    const { items, total } = await this.cars.list({
      category,
      skip: query.skip,
      take: query.limit,
    });
    return { items: items.map(toCarJson), meta: paginationMeta(query, total) };
  }

  async checkAvailability(
    carId: string,
    from: string,
    to: string,
  ): Promise<{ available: boolean }> {
    await this.assertCarExists(carId);
    const range = this.parseRange(from, to);
    return { available: !(await this.bookings.hasOverlap(carId, range.from, range.to)) };
  }

  async listBranches(): Promise<Record<string, unknown>[]> {
    return (await this.cars.listBranches()).map(toBranchJson);
  }

  async listExtras(): Promise<Record<string, unknown>[]> {
    return (await this.cars.listActiveExtras()).map(toExtraJson);
  }

  // ─── pricing (the checkout formula, computed server-side only) ─────────────

  async quote(dto: RentalQuoteDto): Promise<Record<string, unknown>> {
    const q = await this.resolveQuote(dto);
    return this.quoteJson(q);
  }

  /**
   * Validates every input against the database and applies the booking
   * flow's formula:
   *   dailyRate = round(pricePerDay × typeMultiplier)
   *   days      = max(1, ceil(rental minutes / 1440))
   *   subtotal  = dailyRate×days + deliveryFee + Σ(extra×days)
   *   total     = subtotal − round(subtotal×promo%) + round(net × 5% VAT)
   */
  private async resolveQuote(dto: RentalQuoteDto): Promise<ResolvedQuote> {
    const car = await this.assertCarExists(dto.carId);
    const rentalType = RENTAL_TYPE_ID_TO_ENUM[dto.rentalType]!;
    const { from: pickupAt, to: returnAt } = this.parseRange(dto.pickupAt, dto.returnAt);
    if (pickupAt.getTime() < Date.now()) {
      throw new ValidationFailedException([
        { field: 'pickupAt', message: 'Pickup time cannot be in the past' },
      ]);
    }

    const fulfilment =
      dto.fulfilment === 'delivery' ? RentalFulfilment.DELIVERY : RentalFulfilment.PICKUP;

    let branch: RentalBranch | null = null;
    if (fulfilment === RentalFulfilment.PICKUP) {
      branch = await this.cars.findBranchById(dto.branchId!);
      if (!branch) {
        throw new ValidationFailedException([{ field: 'branchId', message: 'Unknown branch' }]);
      }
    }

    const requestedExtras = dto.extras ?? [];
    const extras = await this.cars.findActiveExtrasByKeys(requestedExtras);
    if (extras.length !== requestedExtras.length) {
      const known = new Set(extras.map((e) => e.key));
      const bad = requestedExtras.filter((k) => !known.has(k)).join(', ');
      throw new ValidationFailedException([{ field: 'extras', message: `Unknown extras: ${bad}` }]);
    }

    let promoDiscountPct = 0;
    let promoCode: string | null = null;
    if (dto.promoCode) {
      const promo = await this.cars.findActivePromo(dto.promoCode.trim().toUpperCase());
      if (!promo) {
        throw new ValidationFailedException([
          { field: 'promoCode', message: "That code isn't valid — try ELK10" },
        ]);
      }
      promoDiscountPct = promo.percent;
      promoCode = promo.code;
    }

    const days = Math.max(1, Math.ceil((returnAt.getTime() - pickupAt.getTime()) / MS_PER_DAY));
    const dailyRate = Math.round(car.pricePerDay * RENTAL_RATE_MULTIPLIER[rentalType]);
    const rentalTotal = dailyRate * days;
    const deliveryFee = fulfilment === RentalFulfilment.DELIVERY ? RENTAL_DELIVERY_FEE : 0;
    const extrasTotal = extras.reduce((sum, e) => sum + e.pricePerDay * days, 0);
    const subtotal = rentalTotal + deliveryFee + extrasTotal;
    const promoDiscount = Math.round((subtotal * promoDiscountPct) / 100);
    const vatAmount = Math.round((subtotal - promoDiscount) * RENTAL_VAT_RATE);
    const totalAmount = subtotal - promoDiscount + vatAmount;

    return {
      car,
      rentalType,
      pickupAt,
      returnAt,
      fulfilment,
      branch,
      extras,
      days,
      dailyRate,
      rentalTotal,
      deliveryFee,
      extrasTotal,
      subtotal,
      promoCode,
      promoDiscount,
      vatAmount,
      totalAmount,
    };
  }

  // ─── bookings ──────────────────────────────────────────────────────────────

  async createBooking(
    user: AuthUser,
    dto: CreateRentalBookingDto,
  ): Promise<Record<string, unknown>> {
    const q = await this.resolveQuote(dto);
    const code = await this.generateCode();

    const booking = await this.bookings.createIfAvailable({
      booking: {
        code,
        userId: user.id,
        carId: q.car.id,
        rentalType: q.rentalType,
        fulfilment: q.fulfilment,
        branchId: q.branch?.id ?? null,
        deliveryAddress: dto.deliveryAddress ?? null,
        deliveryBuilding: dto.deliveryBuilding ?? null,
        deliveryNotes: dto.deliveryNotes ?? null,
        pickupAt: q.pickupAt,
        returnAt: q.returnAt,
        days: q.days,
        dailyRate: q.dailyRate,
        rentalTotal: q.rentalTotal,
        deliveryFee: q.deliveryFee,
        extrasTotal: q.extrasTotal,
        subtotal: q.subtotal,
        promoCode: q.promoCode,
        promoDiscount: q.promoDiscount,
        vatAmount: q.vatAmount,
        totalAmount: q.totalAmount,
        status: RentalBookingStatus.CONFIRMED,
        paymentMethod: dto.paymentMethod,
        // internal mock charge — replaced by the payments module later
        paymentRef: `PAY-${code}`,
        paidAt: new Date(),
      },
      extras: q.extras.map((e) => ({ extraId: e.id, name: e.name, pricePerDay: e.pricePerDay })),
    });

    if (!booking) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'CAR_UNAVAILABLE',
        'This car is already booked for the selected dates',
      );
    }

    this.logger.log(`rental booking created: ${code} user=${user.id} car=${q.car.slug}`);
    return toRentalBookingJson(booking);
  }

  async listBookings(user: AuthUser): Promise<Record<string, unknown>[]> {
    return (await this.bookings.listForUser(user.id)).map(toRentalBookingJson);
  }

  async getBooking(user: AuthUser, id: string): Promise<Record<string, unknown>> {
    const booking = await this.bookings.findForUser(id, user.id);
    if (!booking) {
      throw new ResourceNotFoundException('Booking');
    }
    return toRentalBookingJson(booking);
  }

  /** Free cancellation — only while CONFIRMED and before pickup time. */
  async cancelBooking(user: AuthUser, id: string): Promise<void> {
    const booking = await this.bookings.findForUser(id, user.id);
    if (!booking) {
      throw new ResourceNotFoundException('Booking');
    }
    const cancelled = await this.bookings.cancel(id, user.id, new Date());
    if (!cancelled) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'NOT_CANCELLABLE',
        'Bookings can only be cancelled before pickup',
      );
    }
    this.logger.log(`rental booking cancelled (mock refund): ${booking.code}`);
  }

  // ─── pickup / return (provider of the car, or admin) ───────────────────────

  async confirmPickup(actor: AuthUser, id: string): Promise<Record<string, unknown>> {
    const booking = await this.assertCanOperate(actor, id);
    const ok = await this.bookings.markPickedUp(id);
    if (!ok) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        'Pickup can only be confirmed for a confirmed booking',
      );
    }
    this.logger.log(`rental picked up: ${booking.code}`);
    return toRentalBookingJson((await this.bookings.findById(id))!);
  }

  /**
   * Return confirmation. Overdue returns are charged per started extra day
   * at the booked daily rate (late fee added to the total).
   */
  async confirmReturn(actor: AuthUser, id: string): Promise<Record<string, unknown>> {
    const booking = await this.assertCanOperate(actor, id);

    const actualReturnAt = new Date();
    const overdueMs = actualReturnAt.getTime() - booking.returnAt.getTime();
    const extraDays = overdueMs > 0 ? Math.ceil(overdueMs / MS_PER_DAY) : 0;
    const lateFee = extraDays * booking.dailyRate;

    const ok = await this.bookings.markReturned(
      id,
      actualReturnAt,
      lateFee,
      booking.totalAmount + lateFee,
    );
    if (!ok) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        'Return can only be confirmed for an active rental',
      );
    }
    this.logger.log(`rental returned: ${booking.code} lateFee=${lateFee}`);
    return toRentalBookingJson((await this.bookings.findById(id))!);
  }

  // ─── management (provider/admin) ───────────────────────────────────────────

  async createCar(user: AuthUser, dto: CreateRentalCarDto): Promise<Record<string, unknown>> {
    const category = CAR_CATEGORY_ID_TO_ENUM[dto.category]!;
    const slug = await this.uniqueSlug(dto.name);
    const car = await this.cars.create(user.id, slug, {
      name: dto.name,
      category,
      iconKey: dto.iconKey ?? `rental_${dto.category}`,
      seats: dto.seats,
      transmission: dto.transmission,
      fuel: dto.fuel,
      pricePerDay: dto.pricePerDay,
      badge: dto.badge ?? null,
    });
    return toCarJson(car);
  }

  async updateCar(
    user: AuthUser,
    id: string,
    dto: UpdateRentalCarDto,
  ): Promise<Record<string, unknown>> {
    await this.assertCanManageCar(user, id);
    const { category, ...rest } = dto;
    const car = await this.cars.update(id, {
      ...rest,
      ...(category ? { category: CAR_CATEGORY_ID_TO_ENUM[category] } : {}),
    });
    return toCarJson(car);
  }

  async deleteCar(user: AuthUser, id: string): Promise<void> {
    await this.assertCanManageCar(user, id);
    await this.cars.softDelete(id);
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  private async assertCarExists(carId: string): Promise<RentalCar> {
    const car = await this.cars.findById(carId);
    if (!car) {
      throw new ResourceNotFoundException('Car');
    }
    return car;
  }

  private async assertCanManageCar(user: AuthUser, carId: string): Promise<void> {
    const car = await this.assertCarExists(carId);
    if (!user.roles.includes(Role.ADMIN) && car.providerId !== user.id) {
      throw new ForbiddenResourceException('You can only manage your own cars');
    }
  }

  /** Pickup/return may be confirmed by the car's provider or an admin. */
  private async assertCanOperate(actor: AuthUser, bookingId: string) {
    const booking = await this.bookings.findById(bookingId);
    if (!booking) {
      throw new ResourceNotFoundException('Booking');
    }
    const isAdmin = actor.roles.includes(Role.ADMIN);
    if (!isAdmin && booking.car.providerId !== actor.id) {
      throw new ForbiddenResourceException('Only the car provider can confirm this step');
    }
    return booking;
  }

  private parseRange(from: string, to: string): { from: Date; to: Date } {
    const f = new Date(from);
    const t = new Date(to);
    if (t.getTime() <= f.getTime()) {
      throw new ValidationFailedException([
        { field: 'returnAt', message: 'Return time must be after pickup time' },
      ]);
    }
    return { from: f, to: t };
  }

  private quoteJson(q: ResolvedQuote): Record<string, unknown> {
    return {
      car: toCarJson(q.car),
      rentalType: q.rentalType.toLowerCase(),
      pickupAt: q.pickupAt.toISOString(),
      returnAt: q.returnAt.toISOString(),
      fulfilment: q.fulfilment.toLowerCase(),
      branch: q.branch ? toBranchJson(q.branch) : null,
      extras: q.extras.map((e) => ({ key: e.key, name: e.name, pricePerDay: e.pricePerDay })),
      breakdown: {
        days: q.days,
        dailyRate: q.dailyRate,
        rentalTotal: q.rentalTotal,
        deliveryFee: q.deliveryFee,
        extrasTotal: q.extrasTotal,
        subtotal: q.subtotal,
        promoCode: q.promoCode,
        promoDiscount: q.promoDiscount,
        vatAmount: q.vatAmount,
        totalAmount: q.totalAmount,
      },
    };
  }

  private async generateCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `ELK-${RENTAL_CODE_MIN + randomInt(RENTAL_CODE_SPAN)}`;
      if (!(await this.bookings.codeExists(code))) {
        return code;
      }
    }
    return `ELK-${Date.now()}`;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'car';
    let slug = base;
    for (let attempt = 0; attempt < 5; attempt++) {
      if ((await this.cars.findBySlug(slug)) === null) {
        return slug;
      }
      slug = `${base}-${randomInt(10000)}`;
    }
    return `${base}-${Date.now()}`;
  }
}
