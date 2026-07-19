import { randomInt } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Role, StayBookingStatus, StayBookingType, type StayCategoryType } from '@prisma/client';
import { CacheService } from '@/cache/cache.service';
import {
  DomainException,
  DuplicateResourceException,
  ForbiddenResourceException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import { HttpStatus } from '@nestjs/common';
import type { AuthUser } from '@/common/types/auth.types';
import { paginationMeta, type PaginationMeta } from '@/common/http/pagination';
import { UsersRepository } from '@/modules/users/users.repository';
import {
  BOOKING_CODE_ALPHABET,
  BOOKING_CODE_LENGTH,
  CACHE_KEY_CATEGORY_COUNTS,
  CATEGORY_COUNTS_TTL_SECONDS,
  CATEGORY_ENUM_TO_ID,
  CATEGORY_ID_TO_ENUM,
  CATEGORY_PRESENTATION,
  STAY_DEFAULT_LOCATION,
  STAY_SERVICE_FEE,
} from './elkstay.constants';
import type {
  CreateStayBookingDto,
  CreateStayDto,
  ListStaysQuery,
  ScheduleVisitDto,
  UpdateStayDto,
} from './elkstay.dto';
import { toBookingJson, toStayDetailJson, toStayJson } from './elkstay.mapper';
import { StayBookingsRepository } from './stay-bookings.repository';
import { StaysRepository, type StayWriteData } from './stays.repository';

const TOP_RATED_LIMIT = 4;
const CANCELLABLE: StayBookingStatus[] = [
  StayBookingStatus.PENDING,
  StayBookingStatus.VISIT_BOOKED,
];

@Injectable()
export class ElkStayService {
  private readonly logger = new Logger(ElkStayService.name);

  constructor(
    private readonly stays: StaysRepository,
    private readonly bookings: StayBookingsRepository,
    private readonly users: UsersRepository,
    private readonly cache: CacheService,
  ) {}

  // ─── browse ────────────────────────────────────────────────────────────────

  async getHomeFeed(user: AuthUser): Promise<Record<string, unknown>> {
    const [account, counts, topRated] = await Promise.all([
      this.users.findById(user.id),
      this.cache.wrap(CACHE_KEY_CATEGORY_COUNTS, CATEGORY_COUNTS_TTL_SECONDS, () =>
        this.stays.categoryCounts(),
      ),
      this.stays.topRated(TOP_RATED_LIMIT),
    ]);

    const categories = (Object.keys(CATEGORY_PRESENTATION) as StayCategoryType[]).map((type) => ({
      type: CATEGORY_ENUM_TO_ID[type],
      ...CATEGORY_PRESENTATION[type],
      count: counts[type] ?? 0,
    }));

    return {
      userName: firstName(account?.name ?? 'there'),
      location: STAY_DEFAULT_LOCATION,
      categories,
      topRated: topRated.map(toStayJson),
    };
  }

  async listStays(
    query: ListStaysQuery,
  ): Promise<{ items: Record<string, unknown>[]; meta: PaginationMeta }> {
    const { items, total } = await this.stays.list({
      category: query.category ? CATEGORY_ID_TO_ENUM[query.category] : undefined,
      verified: query.verified,
      maxPrice: query.maxPrice,
      roomType: query.roomType,
      meals: query.meals,
      search: query.search,
      skip: query.skip,
      take: query.limit,
    });
    return { items: items.map(toStayJson), meta: paginationMeta(query, total) };
  }

  async getStayDetail(user: AuthUser, stayId: string): Promise<Record<string, unknown>> {
    const stay = await this.stays.findDetailById(stayId);
    if (!stay) {
      throw new ResourceNotFoundException('Stay');
    }
    const isSaved = await this.stays.isFavorite(user.id, stayId);
    return toStayDetailJson(stay, { isSaved });
  }

  // ─── favorites ─────────────────────────────────────────────────────────────

  async addFavorite(user: AuthUser, stayId: string): Promise<void> {
    await this.assertStayExists(stayId);
    await this.stays.addFavorite(user.id, stayId);
  }

  async removeFavorite(user: AuthUser, stayId: string): Promise<void> {
    await this.stays.removeFavorite(user.id, stayId);
  }

  async listFavorites(user: AuthUser): Promise<Record<string, unknown>[]> {
    const items = await this.stays.listFavorites(user.id);
    return items.map(toStayJson);
  }

  // ─── bookings ──────────────────────────────────────────────────────────────

  async listBookings(user: AuthUser): Promise<Record<string, unknown>[]> {
    const items = await this.bookings.listForUser(user.id);
    return items.map(toBookingJson);
  }

  /**
   * "Request to book" flow. The price breakdown is always computed
   * server-side from the room option and coupon — the client's numbers are
   * never trusted. Payment is an internal mock charge (recorded on the
   * booking) until the payments module exists; swapping in a real gateway
   * only replaces the charge step.
   */
  async createBooking(user: AuthUser, dto: CreateStayBookingDto): Promise<Record<string, unknown>> {
    const stay = await this.assertStayExists(dto.stayId);

    const room = await this.stays.findRoomOption(dto.roomOptionId);
    if (!room || room.stayId !== stay.id) {
      throw new ValidationFailedException([
        { field: 'roomOptionId', message: 'Room option does not belong to this stay' },
      ]);
    }

    const moveIn = parseCalendarDate(dto.moveInDate);
    if (moveIn.getTime() < todayUtc().getTime()) {
      throw new ValidationFailedException([
        { field: 'moveInDate', message: 'Move-in date cannot be in the past' },
      ]);
    }

    let discountAmount = 0;
    let couponCode: string | undefined;
    if (dto.couponCode) {
      const coupon = await this.stays.findActiveCoupon(dto.couponCode.toUpperCase());
      if (!coupon) {
        throw new ValidationFailedException([
          { field: 'couponCode', message: 'Invalid or expired coupon' },
        ]);
      }
      discountAmount = coupon.discountAmount;
      couponCode = coupon.code;
    }

    // business rule from the checkout screen:
    // total = first month rent + refundable deposit (1 month) + service fee − discount
    const rent = room.pricePerMonth;
    const deposit = room.pricePerMonth;
    const total = rent + deposit + STAY_SERVICE_FEE - discountAmount;

    const code = await this.generateBookingCode();
    const booking = await this.bookings.create({
      code,
      userId: user.id,
      stayId: stay.id,
      roomOptionId: room.id,
      type: StayBookingType.STAY,
      status: StayBookingStatus.CONFIRMED,
      moveInDate: moveIn,
      durationMonths: dto.durationMonths,
      rentPerMonth: rent,
      depositAmount: deposit,
      serviceFee: STAY_SERVICE_FEE,
      discountAmount,
      couponCode,
      totalPaid: total,
      paymentMethod: dto.paymentMethod,
      // mock/internal charge — replaced by the payments module later
      paymentRef: `PAY-${code}`,
      paidAt: new Date(),
      nextDueDate: firstOfNextMonth(moveIn),
    });

    this.logger.log(`stay booking created: ${code} user=${user.id} stay=${stay.slug}`);
    return {
      ...toBookingJson(booking),
      breakdown: {
        firstMonthRent: rent,
        securityDeposit: deposit,
        serviceFee: STAY_SERVICE_FEE,
        discount: discountAmount,
        total,
      },
      paymentRef: booking.paymentRef,
    };
  }

  /** "Schedule visit" flow — free, no payment, lands in the Requests tab. */
  async scheduleVisit(user: AuthUser, dto: ScheduleVisitDto): Promise<Record<string, unknown>> {
    const stay = await this.assertStayExists(dto.stayId);

    const visitAt = new Date(dto.visitAt);
    if (visitAt.getTime() <= Date.now()) {
      throw new ValidationFailedException([
        { field: 'visitAt', message: 'Visit time must be in the future' },
      ]);
    }
    if (await this.bookings.hasActiveVisit(user.id, stay.id)) {
      throw new DuplicateResourceException('You already have a visit scheduled for this stay');
    }

    const booking = await this.bookings.create({
      code: await this.generateBookingCode(),
      userId: user.id,
      stayId: stay.id,
      type: StayBookingType.VISIT,
      status: StayBookingStatus.VISIT_BOOKED,
      visitAt,
    });
    return toBookingJson(booking);
  }

  async cancelBooking(user: AuthUser, bookingId: string): Promise<void> {
    const booking = await this.bookings.findForUser(bookingId, user.id);
    if (!booking) {
      throw new ResourceNotFoundException('Booking');
    }
    const cancelled = await this.bookings.cancel(bookingId, user.id, CANCELLABLE);
    if (!cancelled) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'NOT_CANCELLABLE',
        'Only pending requests and scheduled visits can be cancelled',
      );
    }
  }

  // ─── management (provider/admin) ───────────────────────────────────────────

  async createStay(user: AuthUser, dto: CreateStayDto): Promise<Record<string, unknown>> {
    const data = this.toWriteData(dto) as StayWriteData;
    const slug = await this.uniqueSlug(dto.name);
    const stay = await this.stays.create(user.id, slug, data);
    await this.cache.del(CACHE_KEY_CATEGORY_COUNTS);
    return toStayDetailJson(stay, { isSaved: false });
  }

  async updateStay(
    user: AuthUser,
    stayId: string,
    dto: UpdateStayDto,
  ): Promise<Record<string, unknown>> {
    await this.assertCanManage(user, stayId);
    const stay = await this.stays.update(stayId, this.toWriteData(dto));
    await this.cache.del(CACHE_KEY_CATEGORY_COUNTS);
    return toStayDetailJson(stay, { isSaved: false });
  }

  async deleteStay(user: AuthUser, stayId: string): Promise<void> {
    await this.assertCanManage(user, stayId);
    await this.stays.softDelete(stayId);
    await this.cache.del(CACHE_KEY_CATEGORY_COUNTS);
  }

  /** Admin approval — flips the "Verified" badge the whole app filters on. */
  async setVerified(stayId: string, isVerified: boolean): Promise<void> {
    await this.assertStayExists(stayId);
    await this.stays.setVerified(stayId, isVerified);
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  private async assertStayExists(stayId: string) {
    const stay = await this.stays.findById(stayId);
    if (!stay) {
      throw new ResourceNotFoundException('Stay');
    }
    return stay;
  }

  private async assertCanManage(user: AuthUser, stayId: string): Promise<void> {
    const stay = await this.assertStayExists(stayId);
    const isAdmin = user.roles.includes(Role.ADMIN);
    if (!isAdmin && stay.providerId !== user.id) {
      throw new ForbiddenResourceException('You can only manage your own stays');
    }
  }

  private toWriteData(dto: UpdateStayDto): Partial<StayWriteData> {
    const { categoryType, gradientStart, gradientEnd, roomOptions, ...rest } = dto;
    return {
      ...rest,
      ...(categoryType ? { categoryType: CATEGORY_ID_TO_ENUM[categoryType] } : {}),
      ...(gradientStart !== undefined ? { gradientStart: BigInt(gradientStart) } : {}),
      ...(gradientEnd !== undefined ? { gradientEnd: BigInt(gradientEnd) } : {}),
      ...(roomOptions
        ? {
            roomOptions,
            // starting-from price shown on cards = cheapest room option
            pricePerMonth: Math.min(...roomOptions.map((r) => r.pricePerMonth)),
          }
        : {}),
    };
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'stay';
    let slug = base;
    for (let attempt = 0; attempt < 5; attempt++) {
      if ((await this.stays.findBySlug(slug)) === null) {
        return slug;
      }
      slug = `${base}-${randomSuffix(4)}`;
    }
    return `${base}-${Date.now()}`;
  }

  private async generateBookingCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = `ELK-${randomSuffix(BOOKING_CODE_LENGTH)}`;
      if (!(await this.bookings.codeExists(code))) {
        return code;
      }
    }
    return `ELK-${randomSuffix(BOOKING_CODE_LENGTH + 3)}`;
  }
}

function randomSuffix(length: number): string {
  return Array.from(
    { length },
    () => BOOKING_CODE_ALPHABET[randomInt(BOOKING_CODE_ALPHABET.length)],
  ).join('');
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/** Parses "YYYY-MM-DD" to a UTC-midnight Date (calendar-date semantics). */
function parseCalendarDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Rent cycle: next due on the 1st of the month after move-in. */
function firstOfNextMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}
