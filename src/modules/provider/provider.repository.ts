import { Inject, Injectable } from '@nestjs/common';
import { AdOrderStatus, type Prisma, type ProviderProfile } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

/** How many past jobs the earnings screen lists. */
const TRANSACTION_LIMIT = 20;

/** One completed job, as an earnings-screen row. */
export interface SellerTransaction {
  icon: string;
  serviceName: string;
  customerName: string;
  at: Date;
  amount: number;
}

/**
 * What a seller has actually done, derived from their orders.
 *
 * The panel used to read these from `provider_requests` and from counters on
 * the profile row — neither of which anything ever wrote, so every seller saw
 * zeros. Orders against their listings are the real record of the work.
 */
export interface SellerActivity {
  activeOrders: number;
  completedJobs: number;
  totalEarnings: number;
  monthEarnings: number;
  rating: number;
  reviewCount: number;
  todaysBookings: number;
  transactions: SellerTransaction[];
}

@Injectable()
export class ProviderRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  // ─── profile ───────────────────────────────────────────────────────────────

  async findProfileByUser(userId: string): Promise<ProviderProfile | null> {
    return this.db.providerProfile.findUnique({ where: { userId } });
  }

  async createProfile(data: Prisma.ProviderProfileUncheckedCreateInput): Promise<ProviderProfile> {
    return this.db.providerProfile.create({ data });
  }

  async updateProfile(
    id: string,
    data: Prisma.ProviderProfileUncheckedUpdateInput,
  ): Promise<ProviderProfile> {
    return this.db.providerProfile.update({ where: { id }, data });
  }

  /** Verifies (or rejects) a provider and, on verify, grants the PROVIDER role — atomically. */
  async setStatusAndRole(
    profileId: string,
    userId: string,
    status: 'VERIFIED' | 'REJECTED',
    roles: string[],
  ): Promise<ProviderProfile> {
    return this.db.$transaction(async (tx) => {
      if (status === 'VERIFIED') {
        await tx.user.update({ where: { id: userId }, data: { roles } });
      }
      return tx.providerProfile.update({ where: { id: profileId }, data: { status } });
    });
  }

  // ─── activity ──────────────────────────────────────────────────────────────

  /** Everything the three panel screens count, in one round of queries. */
  async sellerActivity(sellerId: string): Promise<SellerActivity> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const [active, completed, month, ratings, todays, transactions] = await Promise.all([
      this.db.adOrder.count({
        where: {
          sellerId,
          status: { in: [AdOrderStatus.NEW, AdOrderStatus.IN_PROGRESS] },
        },
      }),
      this.db.adOrder.aggregate({
        where: { sellerId, status: AdOrderStatus.COMPLETED },
        _count: true,
        _sum: { amount: true, feesAmount: true, taxAmount: true },
      }),
      this.db.adOrder.aggregate({
        where: {
          sellerId,
          status: AdOrderStatus.COMPLETED,
          completedAt: { gte: monthStart },
        },
        _sum: { amount: true, feesAmount: true, taxAmount: true },
      }),
      // Straight off the reviews rather than off the listings' denormalised
      // averages, which cannot be averaged again without weighting.
      this.db.review.aggregate({
        where: { adOrder: { sellerId } },
        _avg: { rating: true },
        _count: true,
      }),
      this.db.adOrder.count({
        where: {
          sellerId,
          status: { in: [AdOrderStatus.NEW, AdOrderStatus.IN_PROGRESS] },
          scheduledAt: { gte: dayStart, lt: dayEnd },
        },
      }),
      this.db.adOrder.findMany({
        where: { sellerId, status: AdOrderStatus.COMPLETED },
        orderBy: { completedAt: 'desc' },
        take: TRANSACTION_LIMIT,
        include: { ad: { select: { icon: true } }, buyer: { select: { name: true } } },
      }),
    ]);

    return {
      activeOrders: active,
      completedJobs: completed._count,
      totalEarnings: sumOf(completed._sum),
      monthEarnings: sumOf(month._sum),
      rating: Math.round((ratings._avg.rating ?? 0) * 10) / 10,
      reviewCount: ratings._count,
      todaysBookings: todays,
      transactions: transactions.map((o) => ({
        icon: o.ad.icon,
        serviceName: o.serviceName,
        customerName: o.buyer.name ?? 'ELK customer',
        at: o.completedAt ?? o.createdAt,
        amount: Number(o.amount) + Number(o.feesAmount) + Number(o.taxAmount),
      })),
    };
  }
}

/** What the seller was actually paid: the listing price plus fees and tax. */
function sumOf(sums: {
  amount?: Prisma.Decimal | null;
  feesAmount?: Prisma.Decimal | null;
  taxAmount?: Prisma.Decimal | null;
}): number {
  return Number(sums.amount ?? 0) + Number(sums.feesAmount ?? 0) + Number(sums.taxAmount ?? 0);
}
