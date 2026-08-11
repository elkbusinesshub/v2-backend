import { Inject, Injectable } from '@nestjs/common';
import { AdStatus, type Ad, type Prisma } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

export type AdWithSeller = Ad & {
  seller: { name: string | null; providerProfile: { businessName: string } | null };
  images: { key: string }[];
};

const withSeller = {
  seller: { select: { name: true, providerProfile: { select: { businessName: true } } } },
  images: { select: { key: true }, orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.AdInclude;

@Injectable()
export class MarketplaceRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  /**
   * Ads ranked by engagement — the "best sellers" list.
   *
   * Wishlists sort first and views break ties: saving an ad is a deliberate
   * act, opening one is not, so a heavily-viewed ad nobody saved should not
   * outrank one people actually want. Both columns are denormalised on `ads`
   * and covered by a composite index, so this stays a single indexed read.
   */
  async findTopSellers(limit: number, categorySlug?: string): Promise<AdWithSeller[]> {
    return this.db.ad.findMany({
      where: { status: AdStatus.ACTIVE, ...(categorySlug ? { categorySlug } : {}) },
      orderBy: [{ wishlistCount: 'desc' }, { viewCount: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: withSeller,
    });
  }

  async findAll(params: {
    categorySlug?: string;
    query?: string;
    limit: number;
  }): Promise<AdWithSeller[]> {
    const { categorySlug, query, limit } = params;
    return this.db.ad.findMany({
      where: {
        status: AdStatus.ACTIVE,
        ...(categorySlug ? { categorySlug } : {}),
        ...(query ? { title: { contains: query } } : {}),
      },
      orderBy: [{ wishlistCount: 'desc' }, { viewCount: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: withSeller,
    });
  }

  async findById(id: string): Promise<AdWithSeller | null> {
    return this.db.ad.findFirst({
      where: { id, status: AdStatus.ACTIVE },
      include: withSeller,
    });
  }

  /** The ads this user has wishlisted, out of [adIds] — drives the filled heart. */
  async wishlistedIds(userId: string, adIds: string[]): Promise<Set<string>> {
    if (adIds.length === 0) return new Set();
    const rows = await this.db.adWishlist.findMany({
      where: { userId, adId: { in: adIds } },
      select: { adId: true },
    });
    return new Set(rows.map((r) => r.adId));
  }

  /**
   * Records that [userId] viewed [adId], returning true if this was their
   * first view.
   *
   * The unique (adId, userId) pair is what makes `viewCount` count people
   * rather than page loads — without it, reloading an ad would inflate its
   * ranking. The counter is only bumped on a genuinely new row, inside the
   * same transaction, so the two can never drift.
   */
  async recordView(adId: string, userId: string): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.adView.findUnique({
        where: { adId_userId: { adId, userId } },
        select: { id: true },
      });
      if (existing) return false;

      await tx.adView.create({ data: { adId, userId } });
      await tx.ad.update({ where: { id: adId }, data: { viewCount: { increment: 1 } } });
      return true;
    });
  }

  /** Adds to the wishlist. Idempotent — returns false if it was already saved. */
  async addToWishlist(adId: string, userId: string): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.adWishlist.findUnique({
        where: { adId_userId: { adId, userId } },
        select: { id: true },
      });
      if (existing) return false;

      await tx.adWishlist.create({ data: { adId, userId } });
      await tx.ad.update({ where: { id: adId }, data: { wishlistCount: { increment: 1 } } });
      return true;
    });
  }

  /** Removes from the wishlist. Returns false if it was not saved. */
  async removeFromWishlist(adId: string, userId: string): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.adWishlist.deleteMany({ where: { adId, userId } });
      if (count === 0) return false;

      // Guarded so a double-delete race can never drive the counter negative.
      await tx.ad.updateMany({
        where: { id: adId, wishlistCount: { gt: 0 } },
        data: { wishlistCount: { decrement: 1 } },
      });
      return true;
    });
  }
}
