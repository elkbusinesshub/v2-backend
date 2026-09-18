import { Inject, Injectable } from '@nestjs/common';
import {
  ProviderStatus,
  ServiceRequestKind,
  ServiceRequestStatus,
  type Prisma,
} from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';
import { OPEN_STATUSES, REQUIRE_VERIFIED_PARTNERS } from './service-requests.constants';

const withPeople = {
  buyer: { select: { name: true, phone: true } },
  seller: {
    select: {
      name: true,
      phone: true,
      providerProfile: { select: { businessName: true, contactNumber: true } },
    },
  },
  staff: { select: { name: true, phone: true } },
} satisfies Prisma.ServiceRequestInclude;

export type ServiceRequestRow = Prisma.ServiceRequestGetPayload<{ include: typeof withPeople }>;

export interface CleaningCandidate {
  sellerId: string;
  price: number;
}

export interface RentalCandidate {
  sellerId: string;
  quantity: number;
  pricePerDay: number;
  shop: { address: string; lat: number; lng: number; deliveryFee: number };
}

/** A wallet movement from buyer to seller, made inside a status change. */
export interface ServicePayment {
  buyerId: string;
  sellerId: string;
  amount: number;
  reference: string;
  buyerEntry: { icon: string; title: string; colorHex: number };
  sellerEntry: { icon: string; title: string; colorHex: number };
}

export type TransitionResult = 'ok' | 'stale' | 'insufficient_balance';

/** Thrown inside a transaction purely to roll it back. */
class InsufficientBalance extends Error {}

@Injectable()
export class ServiceRequestsRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async findById(id: string): Promise<ServiceRequestRow | null> {
    return this.db.serviceRequest.findUnique({ where: { id }, include: withPeople });
  }

  async create(data: Prisma.ServiceRequestUncheckedCreateInput): Promise<ServiceRequestRow> {
    return this.db.serviceRequest.create({ data, include: withPeople });
  }

  async findForBuyer(
    buyerId: string,
    statuses?: ServiceRequestStatus[],
    kind?: ServiceRequestKind,
  ): Promise<ServiceRequestRow[]> {
    return this.db.serviceRequest.findMany({
      where: {
        buyerId,
        ...(statuses ? { status: { in: statuses } } : {}),
        ...(kind ? { kind } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: withPeople,
    });
  }

  async findForSeller(
    sellerId: string,
    statuses?: ServiceRequestStatus[],
    kind?: ServiceRequestKind,
  ): Promise<ServiceRequestRow[]> {
    return this.db.serviceRequest.findMany({
      where: {
        sellerId,
        ...(statuses ? { status: { in: statuses } } : {}),
        ...(kind ? { kind } : {}),
      },
      orderBy: { scheduledAt: 'asc' },
      take: 100,
      include: withPeople,
    });
  }

  /** Jobs a staff member can work: their sellers' live jobs, unassigned or theirs. */
  async findForStaff(staffUserId: string, sellerIds: string[]): Promise<ServiceRequestRow[]> {
    if (sellerIds.length === 0) return [];
    return this.db.serviceRequest.findMany({
      where: {
        sellerId: { in: sellerIds },
        status: { in: [ServiceRequestStatus.ACCEPTED, ServiceRequestStatus.IN_PROGRESS] },
        OR: [{ staffId: null }, { staffId: staffUserId }],
      },
      orderBy: { scheduledAt: 'asc' },
      include: withPeople,
    });
  }

  async walletBalance(userId: string): Promise<number> {
    const user = await this.db.user.findFirst({
      where: { id: userId },
      select: { walletBalance: true },
    });
    return user ? Number(user.walletBalance) : 0;
  }

  // ─── assignment ────────────────────────────────────────────────────────────

  private partnerProfileFilter(): Prisma.ProviderProfileWhereInput {
    return {
      isAvailable: true,
      ...(REQUIRE_VERIFIED_PARTNERS ? { status: ProviderStatus.VERIFIED } : {}),
    };
  }

  async findCleaningCandidates(
    district: string,
    serviceType: string,
    excludedSellerIds: string[],
  ): Promise<CleaningCandidate[]> {
    const rows = await this.db.cleaningServicePrice.findMany({
      where: {
        serviceType,
        sellerId: { notIn: excludedSellerIds },
        seller: {
          deletedAt: null,
          partnerDistricts: { some: { district } },
          providerProfile: this.partnerProfileFilter(),
        },
      },
      select: { sellerId: true, price: true },
    });
    return rows.map((r) => ({ sellerId: r.sellerId, price: Number(r.price) }));
  }

  async findRentalCandidates(
    vehicleType: string,
    excludedSellerIds: string[],
  ): Promise<RentalCandidate[]> {
    const rows = await this.db.rentalVehicle.findMany({
      where: {
        vehicleType,
        quantity: { gt: 0 },
        sellerId: { notIn: excludedSellerIds },
        seller: {
          deletedAt: null,
          rentalShop: { isNot: null },
          providerProfile: this.partnerProfileFilter(),
        },
      },
      select: {
        sellerId: true,
        quantity: true,
        pricePerDay: true,
        seller: { select: { rentalShop: true } },
      },
    });
    return rows.flatMap((r) => {
      const shop = r.seller.rentalShop;
      if (!shop) return [];
      return [
        {
          sellerId: r.sellerId,
          quantity: r.quantity,
          pricePerDay: Number(r.pricePerDay),
          shop: {
            address: shop.address,
            lat: Number(shop.lat),
            lng: Number(shop.lng),
            deliveryFee: Number(shop.deliveryFee),
          },
        },
      ];
    });
  }

  /** Open requests per partner — overall, or those overlapping a window. */
  async countOpen(params: {
    kind: ServiceRequestKind;
    sellerIds: string[];
    serviceType?: string;
    from?: Date;
    to?: Date;
    /** Rentals: count requests whose period overlaps [from, to). */
    overlapping?: boolean;
  }): Promise<Map<string, number>> {
    const { kind, sellerIds, serviceType, from, to, overlapping } = params;
    if (sellerIds.length === 0) return new Map();
    const window: Prisma.ServiceRequestWhereInput =
      from && to
        ? overlapping
          ? { scheduledAt: { lt: to }, endAt: { gt: from } }
          : { scheduledAt: { gte: from, lt: to } }
        : {};
    const groups = await this.db.serviceRequest.groupBy({
      by: ['sellerId'],
      where: {
        kind,
        sellerId: { in: sellerIds },
        status: { in: OPEN_STATUSES },
        ...(serviceType ? { serviceType } : {}),
        ...window,
      },
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.sellerId, g._count._all]));
  }

  // ─── transitions ───────────────────────────────────────────────────────────

  /**
   * Moves a request out of [from], optionally paying for it in the same
   * transaction. `stale` when the request was no longer in [from] — someone
   * else got there first — and `insufficient_balance` when the buyer could not
   * pay, in which case nothing at all was changed.
   */
  async transition(
    id: string,
    from: ServiceRequestStatus,
    data: Prisma.ServiceRequestUncheckedUpdateManyInput,
    payment?: ServicePayment,
  ): Promise<TransitionResult> {
    try {
      return await this.db.$transaction(async (tx) => {
        const updated = await tx.serviceRequest.updateMany({
          where: { id, status: from },
          data,
        });
        if (updated.count !== 1) return 'stale';
        if (payment) {
          const debited = await tx.user.updateMany({
            where: { id: payment.buyerId, walletBalance: { gte: payment.amount } },
            data: { walletBalance: { decrement: payment.amount } },
          });
          if (debited.count !== 1) throw new InsufficientBalance();
          await tx.user.update({
            where: { id: payment.sellerId },
            data: { walletBalance: { increment: payment.amount } },
          });
          await tx.walletTransaction.createMany({
            data: [
              {
                ...payment.buyerEntry,
                userId: payment.buyerId,
                amount: payment.amount,
                isCredit: false,
              },
              {
                ...payment.sellerEntry,
                userId: payment.sellerId,
                amount: payment.amount,
                isCredit: true,
              },
            ],
          });
          await tx.serviceRequest.update({
            where: { id },
            data: { paidAt: new Date(), paymentReference: payment.reference },
          });
        }
        return 'ok' as const;
      });
    } catch (err) {
      if (err instanceof InsufficientBalance) return 'insufficient_balance';
      throw err;
    }
  }

  /** A wrong code: one more attempt used, unless the request moved on. */
  async recordWrongOtp(id: string): Promise<number> {
    await this.db.serviceRequest.updateMany({
      where: { id, status: ServiceRequestStatus.ACCEPTED },
      data: { otpAttempts: { increment: 1 } },
    });
    const row = await this.db.serviceRequest.findUnique({
      where: { id },
      select: { otpAttempts: true },
    });
    return row?.otpAttempts ?? 0;
  }

  async replaceOtp(id: string, otpCode: string): Promise<boolean> {
    const updated = await this.db.serviceRequest.updateMany({
      where: { id, status: ServiceRequestStatus.ACCEPTED },
      data: { otpCode, otpAttempts: 0 },
    });
    return updated.count === 1;
  }
}
