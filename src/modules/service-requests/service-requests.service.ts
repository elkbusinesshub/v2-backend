import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ServiceRequestKind, ServiceRequestStatus } from '@prisma/client';
import {
  DomainException,
  ForbiddenResourceException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { PartnerSetupRepository } from './partner-setup.repository';
import {
  CHARGE_AT,
  CLEANING_SERVICE_TYPES,
  CLEANING_SLOT_HOURS,
  FULFILMENTS,
  MAX_OTP_ATTEMPTS,
  MAX_RENTAL_DAYS,
  OPEN_STATUSES,
  OTP_LENGTH,
  REQUEST_NOTIFICATION_COLOR,
  SERVICE_DISTRICTS,
  VEHICLE_TYPES,
  WALLET_TXN_SERVICE_EARNING,
  WALLET_TXN_SERVICE_PAYMENT,
} from './service-requests.constants';
import type {
  AcceptRequestDto,
  CreateCleaningRequestDto,
  CreateRentalRequestDto,
  RequestListQueryDto,
} from './service-requests.dto';
import { toServiceRequestJson, type RequestViewer } from './service-requests.mapper';
import {
  ServiceRequestsRepository,
  type ServiceRequestRow,
  type TransitionResult,
} from './service-requests.repository';

type Json = Record<string, unknown>;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Clock skew allowed on "must be in the future". */
const FUTURE_GRACE_MS = 5 * 60 * 1000;

/** Straight-line km between two points — enough to rank shops by nearness. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}

/** Whole days charged for a rental: any part of a day counts, minimum one. */
export function rentalDays(start: Date, end: Date): number {
  return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS));
}

/**
 * Cleaning and vehicle-rental requests: one lifecycle, two kinds.
 *
 *  1. The buyer asks; the server picks a partner and prices it from that
 *     partner's own rates.
 *  2. The partner accepts (a 6-digit OTP is made, shown only to the buyer) or
 *     declines (the buyer can try again, and that partner is skipped).
 *  3. On site, the partner or their staff enters the buyer's OTP. Five wrong
 *     codes lock it until the buyer gets a new one.
 *  4. The buyer's wallet pays the partner — at the OTP for cleaning, at
 *     Complete for a rental (see CHARGE_AT).
 */
@Injectable()
export class ServiceRequestsService {
  private readonly logger = new Logger(ServiceRequestsService.name);

  constructor(
    private readonly requests: ServiceRequestsRepository,
    private readonly partners: PartnerSetupRepository,
    private readonly notifications: NotificationsService,
  ) {}

  catalog(): Json {
    return {
      districts: SERVICE_DISTRICTS,
      cleaningServiceTypes: CLEANING_SERVICE_TYPES,
      vehicleTypes: VEHICLE_TYPES,
      fulfilments: FULFILMENTS,
      otpLength: OTP_LENGTH,
      maxOtpAttempts: MAX_OTP_ATTEMPTS,
      chargeAt: CHARGE_AT,
    };
  }

  // ─── buyer ─────────────────────────────────────────────────────────────────

  async createCleaning(user: AuthUser, dto: CreateCleaningRequestDto): Promise<Json> {
    const scheduledAt = this.futureDate(dto.scheduledAt, 'scheduledAt');
    const row = await this.assignCleaning(user, {
      district: dto.district,
      serviceType: dto.serviceType,
      scheduledAt,
      addressText: dto.addressText,
      lat: dto.lat,
      lng: dto.lng,
      note: dto.note ?? null,
      excluded: [],
      retryOfId: null,
    });
    return toServiceRequestJson(row, 'buyer');
  }

  async createRental(user: AuthUser, dto: CreateRentalRequestDto): Promise<Json> {
    const startAt = this.futureDate(dto.startAt, 'startAt');
    const endAt = new Date(dto.endAt);
    if (!(endAt.getTime() > startAt.getTime())) {
      throw new ValidationFailedException([
        { field: 'endAt', message: 'endAt must be after startAt' },
      ]);
    }
    if (rentalDays(startAt, endAt) > MAX_RENTAL_DAYS) {
      throw new ValidationFailedException([
        { field: 'endAt', message: `A rental can be at most ${MAX_RENTAL_DAYS} days` },
      ]);
    }
    const row = await this.assignRental(user, {
      vehicleType: dto.vehicleType,
      startAt,
      endAt,
      fulfilment: dto.fulfilment,
      addressText: dto.addressText,
      lat: dto.lat,
      lng: dto.lng,
      note: dto.note ?? null,
      excluded: [],
      retryOfId: null,
    });
    return toServiceRequestJson(row, 'buyer');
  }

  async listMine(user: AuthUser, query: RequestListQueryDto): Promise<Json[]> {
    const rows = await this.requests.findForBuyer(
      user.id,
      this.statusesFor(query.scope),
      query.kind,
    );
    return rows.map((r) => toServiceRequestJson(r, 'buyer'));
  }

  async detail(user: AuthUser, id: string): Promise<Json> {
    const row = await this.load(id);
    return toServiceRequestJson(row, await this.viewerOf(user, row));
  }

  /** A declined request, asked again of the next partner. */
  async retry(user: AuthUser, id: string): Promise<Json> {
    const old = await this.load(id);
    this.assertBuyer(user, old);
    this.assertStatus(
      old,
      [ServiceRequestStatus.DECLINED],
      'Only a declined request can be tried again',
    );
    const excluded = [...this.excludedOf(old), old.sellerId];
    const common = {
      addressText: old.addressText,
      lat: Number(old.lat),
      lng: Number(old.lng),
      note: old.note,
      excluded,
      retryOfId: old.id,
    };
    const row =
      old.kind === ServiceRequestKind.CLEANING
        ? await this.assignCleaning(user, {
            ...common,
            district: old.district ?? '',
            serviceType: old.serviceType,
            scheduledAt: this.futureDate(old.scheduledAt.toISOString(), 'scheduledAt'),
          })
        : await this.assignRental(user, {
            ...common,
            vehicleType: old.serviceType,
            startAt: this.futureDate(old.scheduledAt.toISOString(), 'startAt'),
            endAt: old.endAt ?? new Date(old.scheduledAt.getTime() + DAY_MS),
            fulfilment: old.fulfilment ?? 'PICKUP',
          });
    return toServiceRequestJson(row, 'buyer');
  }

  async cancel(user: AuthUser, id: string): Promise<Json> {
    const row = await this.load(id);
    this.assertBuyer(user, row);
    this.assertStatus(
      row,
      [ServiceRequestStatus.PENDING, ServiceRequestStatus.ACCEPTED],
      'This request can no longer be cancelled',
    );
    await this.move(row, row.status, {
      status: ServiceRequestStatus.CANCELLED,
      cancelledAt: new Date(),
    });
    await this.notify(
      row.sellerId,
      row,
      'Request cancelled',
      `The customer cancelled ${row.code}.`,
    );
    return this.reload(id, 'buyer');
  }

  /** A fresh code, and the wrong-attempt count starts again. */
  async newCode(user: AuthUser, id: string): Promise<Json> {
    const row = await this.load(id);
    this.assertBuyer(user, row);
    this.assertStatus(
      row,
      [ServiceRequestStatus.ACCEPTED],
      'A new code is only for an accepted request',
    );
    if (!(await this.requests.replaceOtp(id, this.otp()))) {
      throw this.stale();
    }
    return this.reload(id, 'buyer');
  }

  // ─── partner ───────────────────────────────────────────────────────────────

  async listIncoming(user: AuthUser, query: RequestListQueryDto): Promise<Json[]> {
    const rows = await this.requests.findForSeller(
      user.id,
      this.statusesFor(query.scope),
      query.kind,
    );
    return rows.map((r) => toServiceRequestJson(r, 'seller'));
  }

  async listStaffJobs(user: AuthUser): Promise<Json[]> {
    const sellers = await this.partners.sellersOfStaff(user.id);
    const rows = await this.requests.findForStaff(
      user.id,
      sellers.map((s) => s.sellerId),
    );
    return rows.map((r) => toServiceRequestJson(r, 'staff'));
  }

  async accept(user: AuthUser, id: string, dto: AcceptRequestDto): Promise<Json> {
    const row = await this.load(id);
    this.assertSeller(user, row);
    this.assertStatus(
      row,
      [ServiceRequestStatus.PENDING],
      'Only a pending request can be accepted',
    );

    let staffUserId: string | null = null;
    if (dto.staffId) {
      const staff = await this.partners.findStaff(dto.staffId);
      if (!staff || staff.sellerId !== user.id) {
        throw new ValidationFailedException([
          { field: 'staffId', message: 'Not one of your staff' },
        ]);
      }
      staffUserId = staff.staffUserId;
    }

    await this.move(row, ServiceRequestStatus.PENDING, {
      status: ServiceRequestStatus.ACCEPTED,
      acceptedAt: new Date(),
      otpCode: this.otp(),
      otpAttempts: 0,
      staffId: staffUserId,
    });
    await this.notify(
      row.buyerId,
      row,
      'Request accepted',
      `${row.code} was accepted. Your code is in the app — share it when the partner arrives.`,
    );
    return this.reload(id, 'seller');
  }

  async decline(user: AuthUser, id: string): Promise<Json> {
    const row = await this.load(id);
    this.assertSeller(user, row);
    this.assertStatus(
      row,
      [ServiceRequestStatus.PENDING],
      'Only a pending request can be declined',
    );
    await this.move(row, ServiceRequestStatus.PENDING, {
      status: ServiceRequestStatus.DECLINED,
      declinedAt: new Date(),
    });
    await this.notify(
      row.buyerId,
      row,
      'Request declined',
      `${row.code} was declined. Try again to find another partner.`,
    );
    return this.reload(id, 'seller');
  }

  /** The seller or their staff enters the code the buyer reads out. */
  async verifyOtp(user: AuthUser, id: string, otpCode: string): Promise<Json> {
    const row = await this.load(id);
    const viewer = await this.assertWorker(user, row);
    this.assertStatus(
      row,
      [ServiceRequestStatus.ACCEPTED],
      'The code is only checked for an accepted request',
    );

    if (row.otpAttempts >= MAX_OTP_ATTEMPTS) {
      throw this.otpLocked();
    }
    if (row.otpCode !== otpCode) {
      const attempts = await this.requests.recordWrongOtp(id);
      if (attempts >= MAX_OTP_ATTEMPTS) {
        throw this.otpLocked();
      }
      throw new ValidationFailedException([
        {
          field: 'otpCode',
          message: `Incorrect code — ${MAX_OTP_ATTEMPTS - attempts} ${MAX_OTP_ATTEMPTS - attempts === 1 ? 'try' : 'tries'} left`,
        },
      ]);
    }

    const now = new Date();
    await this.move(
      row,
      ServiceRequestStatus.ACCEPTED,
      { status: ServiceRequestStatus.IN_PROGRESS, startedAt: now },
      CHARGE_AT[row.kind] === 'OTP',
    );
    await this.notify(
      row.buyerId,
      row,
      row.kind === ServiceRequestKind.CLEANING ? 'Work started' : 'Vehicle handed over',
      CHARGE_AT[row.kind] === 'OTP'
        ? `${row.code} · ₹${Number(row.amount) + Number(row.feesAmount)} paid from your wallet.`
        : `${row.code} has started.`,
    );
    return this.reload(id, viewer);
  }

  async complete(user: AuthUser, id: string): Promise<Json> {
    const row = await this.load(id);
    const viewer = await this.assertWorker(user, row);
    this.assertStatus(
      row,
      [ServiceRequestStatus.IN_PROGRESS],
      'Only a started job can be completed',
    );
    await this.move(
      row,
      ServiceRequestStatus.IN_PROGRESS,
      { status: ServiceRequestStatus.COMPLETED, completedAt: new Date() },
      CHARGE_AT[row.kind] === 'COMPLETE',
    );
    await this.notify(
      row.buyerId,
      row,
      'Completed',
      CHARGE_AT[row.kind] === 'COMPLETE'
        ? `${row.code} · ₹${Number(row.amount) + Number(row.feesAmount)} paid from your wallet.`
        : `${row.code} is complete.`,
    );
    return this.reload(id, viewer);
  }

  // ─── assignment ────────────────────────────────────────────────────────────

  private async assignCleaning(
    user: AuthUser,
    input: {
      district: string;
      serviceType: string;
      scheduledAt: Date;
      addressText: string;
      lat: number;
      lng: number;
      note: string | null;
      excluded: string[];
      retryOfId: string | null;
    },
  ): Promise<ServiceRequestRow> {
    const excluded = [...new Set([...input.excluded, user.id])];
    const candidates = await this.requests.findCleaningCandidates(
      input.district,
      input.serviceType,
      excluded,
    );
    const ids = candidates.map((c) => c.sellerId);
    const slot = CLEANING_SLOT_HOURS * HOUR_MS;
    const [busy, load] = await Promise.all([
      this.requests.countOpen({
        kind: ServiceRequestKind.CLEANING,
        sellerIds: ids,
        from: new Date(input.scheduledAt.getTime() - slot),
        to: new Date(input.scheduledAt.getTime() + slot),
      }),
      this.requests.countOpen({ kind: ServiceRequestKind.CLEANING, sellerIds: ids }),
    ]);
    // Free at that time; then whoever has the least work, then the cheapest.
    const chosen = candidates
      .filter((c) => !busy.get(c.sellerId))
      .sort(
        (a, b) => (load.get(a.sellerId) ?? 0) - (load.get(b.sellerId) ?? 0) || a.price - b.price,
      )[0];
    if (!chosen) throw this.noPartner();

    await this.assertCanPay(user, chosen.price);
    const row = await this.requests.create({
      code: this.code(),
      kind: ServiceRequestKind.CLEANING,
      buyerId: user.id,
      sellerId: chosen.sellerId,
      district: input.district,
      serviceType: input.serviceType,
      scheduledAt: input.scheduledAt,
      addressText: input.addressText,
      lat: input.lat,
      lng: input.lng,
      note: input.note,
      amount: chosen.price,
      excludedSellerIds: input.excluded,
      retryOfId: input.retryOfId,
    });
    await this.notify(
      chosen.sellerId,
      row,
      'New cleaning request',
      `${this.label(row.serviceType)} · ${row.code}`,
    );
    return row;
  }

  private async assignRental(
    user: AuthUser,
    input: {
      vehicleType: string;
      startAt: Date;
      endAt: Date;
      fulfilment: string;
      addressText: string;
      lat: number;
      lng: number;
      note: string | null;
      excluded: string[];
      retryOfId: string | null;
    },
  ): Promise<ServiceRequestRow> {
    const excluded = [...new Set([...input.excluded, user.id])];
    const candidates = await this.requests.findRentalCandidates(input.vehicleType, excluded);
    const booked = await this.requests.countOpen({
      kind: ServiceRequestKind.RENTAL,
      sellerIds: candidates.map((c) => c.sellerId),
      serviceType: input.vehicleType,
      from: input.startAt,
      to: input.endAt,
      overlapping: true,
    });
    // A vehicle of that type free for the whole period; then the nearest shop,
    // then the cheapest.
    const chosen = candidates
      .filter((c) => (booked.get(c.sellerId) ?? 0) < c.quantity)
      .map((c) => ({ ...c, km: distanceKm(input.lat, input.lng, c.shop.lat, c.shop.lng) }))
      .sort((a, b) => a.km - b.km || a.pricePerDay - b.pricePerDay)[0];
    if (!chosen) throw this.noPartner();

    const isDelivery = input.fulfilment === 'DELIVERY';
    const amount = chosen.pricePerDay * rentalDays(input.startAt, input.endAt);
    const fees = isDelivery ? chosen.shop.deliveryFee : 0;
    await this.assertCanPay(user, amount + fees);

    const row = await this.requests.create({
      code: this.code(),
      kind: ServiceRequestKind.RENTAL,
      buyerId: user.id,
      sellerId: chosen.sellerId,
      serviceType: input.vehicleType,
      scheduledAt: input.startAt,
      endAt: input.endAt,
      fulfilment: input.fulfilment,
      addressText: input.addressText,
      lat: input.lat,
      lng: input.lng,
      shopAddress: chosen.shop.address,
      shopLat: chosen.shop.lat,
      shopLng: chosen.shop.lng,
      note: input.note,
      amount,
      feesAmount: fees,
      excludedSellerIds: input.excluded,
      retryOfId: input.retryOfId,
    });
    await this.notify(
      chosen.sellerId,
      row,
      'New rental request',
      `${this.label(row.serviceType)} · ${row.code}`,
    );
    return row;
  }

  // ─── helpers ───────────────────────────────────────────────────────────────

  /**
   * Checked when asking, so a buyer is not sent a partner they cannot pay.
   * The charge itself re-checks, since the balance can change in between.
   */
  private async assertCanPay(user: AuthUser, total: number): Promise<void> {
    if ((await this.requests.walletBalance(user.id)) < total) {
      throw new DomainException(
        HttpStatus.PAYMENT_REQUIRED,
        'INSUFFICIENT_BALANCE',
        `Your wallet needs at least ₹${total} for this request. Please top up.`,
      );
    }
  }

  private async move(
    row: ServiceRequestRow,
    from: ServiceRequestStatus,
    data: Parameters<ServiceRequestsRepository['transition']>[2],
    charge = false,
  ): Promise<void> {
    const total = Number(row.amount) + Number(row.feesAmount);
    const label = `${this.label(row.serviceType)} · ${row.code}`;
    const result: TransitionResult = await this.requests.transition(
      row.id,
      from,
      data,
      charge
        ? {
            buyerId: row.buyerId,
            sellerId: row.sellerId,
            amount: total,
            reference: `#ELK-${new Date().getFullYear()}-${randomInt(100000).toString().padStart(5, '0')}`,
            buyerEntry: { ...WALLET_TXN_SERVICE_PAYMENT, title: label },
            sellerEntry: { ...WALLET_TXN_SERVICE_EARNING, title: `Earning · ${label}` },
          }
        : undefined,
    );
    if (result === 'stale') throw this.stale();
    if (result === 'insufficient_balance') {
      throw new DomainException(
        HttpStatus.PAYMENT_REQUIRED,
        'INSUFFICIENT_BALANCE',
        `The customer's wallet does not have ₹${total}. Ask them to top up, then try again.`,
      );
    }
  }

  private async load(id: string): Promise<ServiceRequestRow> {
    const row = await this.requests.findById(id);
    if (!row) throw new ResourceNotFoundException('Request');
    return row;
  }

  private async reload(id: string, viewer: RequestViewer): Promise<Json> {
    return toServiceRequestJson(await this.load(id), viewer);
  }

  private async viewerOf(user: AuthUser, row: ServiceRequestRow): Promise<RequestViewer> {
    if (row.buyerId === user.id) return 'buyer';
    if (row.sellerId === user.id) return 'seller';
    if (await this.partners.findStaffMembership(row.sellerId, user.id)) return 'staff';
    throw new ForbiddenResourceException('This is not your request');
  }

  private assertBuyer(user: AuthUser, row: ServiceRequestRow): void {
    if (row.buyerId !== user.id) throw new ForbiddenResourceException('This is not your request');
  }

  private assertSeller(user: AuthUser, row: ServiceRequestRow): void {
    if (row.sellerId !== user.id)
      throw new ForbiddenResourceException('This request is not assigned to you');
  }

  /** The partner, or one of their staff who is on the job or on no job. */
  private async assertWorker(user: AuthUser, row: ServiceRequestRow): Promise<RequestViewer> {
    if (row.sellerId === user.id) return 'seller';
    const staff = await this.partners.findStaffMembership(row.sellerId, user.id);
    if (staff && (row.staffId === null || row.staffId === user.id)) return 'staff';
    throw new ForbiddenResourceException('This request is not assigned to you');
  }

  private assertStatus(
    row: ServiceRequestRow,
    allowed: ServiceRequestStatus[],
    message: string,
  ): void {
    if (!allowed.includes(row.status)) {
      throw new DomainException(HttpStatus.CONFLICT, 'INVALID_TRANSITION', message);
    }
  }

  private statusesFor(scope?: 'open' | 'done'): ServiceRequestStatus[] | undefined {
    if (scope === 'open') return OPEN_STATUSES;
    if (scope === 'done') {
      return Object.values(ServiceRequestStatus).filter((s) => !OPEN_STATUSES.includes(s));
    }
    return undefined;
  }

  private excludedOf(row: ServiceRequestRow): string[] {
    const value = row.excludedSellerIds;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  }

  private futureDate(iso: string, field: string): Date {
    const date = new Date(iso);
    if (date.getTime() < Date.now() - FUTURE_GRACE_MS) {
      throw new ValidationFailedException([{ field, message: `${field} must be in the future` }]);
    }
    return date;
  }

  private otp(): string {
    return String(randomInt(10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
  }

  private code(): string {
    const body = Array.from(
      { length: 5 },
      () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
    ).join('');
    return `ELK-S-${body}`;
  }

  /** HOME_CLEANING → Home cleaning, for notification text. */
  private label(type: string): string {
    const words = type.toLowerCase().replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  private async notify(
    userId: string,
    row: ServiceRequestRow,
    title: string,
    message: string,
  ): Promise<void> {
    try {
      await this.notifications.create({
        userId,
        icon: row.kind === ServiceRequestKind.CLEANING ? '🧹' : '🚗',
        colorHex: REQUEST_NOTIFICATION_COLOR,
        title,
        message,
      });
    } catch (err) {
      // A notification failing must not undo what already happened.
      this.logger.warn({ err, requestId: row.id }, 'could not send request notification');
    }
  }

  private noPartner(): DomainException {
    return new DomainException(
      HttpStatus.CONFLICT,
      'NO_PARTNER_AVAILABLE',
      'No partner is available for this right now. Try another time or option.',
    );
  }

  private otpLocked(): DomainException {
    return new DomainException(
      HttpStatus.LOCKED,
      'OTP_LOCKED',
      'Too many wrong codes. Ask the customer to get a new code in their app.',
    );
  }

  private stale(): DomainException {
    return new DomainException(
      HttpStatus.CONFLICT,
      'INVALID_TRANSITION',
      'This request has just changed. Refresh and try again.',
    );
  }
}
