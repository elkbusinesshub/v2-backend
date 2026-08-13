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
        // Matches the same fields the best-sellers search box matched
        // client-side before it was wired here: title, category and the
        // seller's display name. `sellerName` is the business name falling
        // back to the user's name, so both have to be searched.
        ...(query
          ? {
              OR: [
                { title: { contains: query } },
                { categorySlug: { contains: query } },
                { seller: { name: { contains: query } } },
                { seller: { providerProfile: { businessName: { contains: query } } } },
              ],
            }
          : {}),
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

  /**
   * A seller's own listings, newest first.
   *
   * Unlike every other read here this is *not* filtered to ACTIVE: a seller
   * has to see their own drafts and paused ads, which is the whole point of
   * the My Listings screen.
   */
  async findBySeller(sellerId: string, status?: AdStatus): Promise<AdWithSeller[]> {
    return this.db.ad.findMany({
      where: { sellerId, deletedAt: null, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: withSeller,
    });
  }

  /** One ad in any status, for the owner to read, edit or delete. */
  async findOwned(id: string): Promise<AdWithSeller | null> {
    return this.db.ad.findFirst({ where: { id, deletedAt: null }, include: withSeller });
  }

  async create(
    sellerId: string,
    data: Omit<Prisma.AdUncheckedCreateInput, 'sellerId'>,
    imageKeys: string[],
  ): Promise<AdWithSeller> {
    return this.db.ad.create({
      data: {
        ...data,
        sellerId,
        images: {
          create: imageKeys.map((key, sortOrder) => ({ key, sortOrder })),
        },
      },
      include: withSeller,
    });
  }

  /**
   * Updates an ad, replacing its photos only when [imageKeys] is given.
   *
   * Undefined means "leave the photos alone"; an empty array means "remove
   * them all". Collapsing those two would make it impossible to edit a title
   * without also wiping the images.
   */
  async update(
    id: string,
    data: Prisma.AdUncheckedUpdateInput,
    imageKeys?: string[],
  ): Promise<AdWithSeller> {
    return this.db.$transaction(async (tx) => {
      if (imageKeys) {
        await tx.adImage.deleteMany({ where: { adId: id } });
        if (imageKeys.length > 0) {
          await tx.adImage.createMany({
            data: imageKeys.map((key, sortOrder) => ({ adId: id, key, sortOrder })),
          });
        }
      }
      return tx.ad.update({ where: { id }, data, include: withSeller });
    });
  }

  /**
   * Soft delete. The row stays so the wishlists and views pointing at it keep
   * their referential integrity, and so a seller's history survives.
   */
  async softDelete(id: string): Promise<void> {
    await this.db.ad.update({
      where: { id },
      data: { deletedAt: new Date(), status: AdStatus.PAUSED },
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
