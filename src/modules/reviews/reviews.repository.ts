import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, Review } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

@Injectable()
export class ReviewsRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async findByAdOrderId(adOrderId: string): Promise<Review | null> {
    return this.db.review.findUnique({ where: { adOrderId } });
  }

  /**
   * A completed order the buyer placed, with the seller and listing needed to
   * label the rating screen. Scoped to the buyer: the person who paid is the
   * one who gets to rate it.
   */
  async findAdOrderForBuyer(id: string, buyerId: string) {
    return this.db.adOrder.findFirst({
      where: { id, buyerId },
      include: { seller: { select: { name: true } }, ad: { select: { title: true } } },
    });
  }

  async create(data: Prisma.ReviewUncheckedCreateInput): Promise<Review> {
    return this.db.review.create({ data });
  }

  /** Average rating (1 decimal) + count across every review of a listing's orders. */
  async aggregateForAd(adId: string): Promise<{ average: number; count: number }> {
    const result = await this.db.review.aggregate({
      where: { adOrder: { adId } },
      _avg: { rating: true },
      _count: true,
    });
    return {
      average: Math.round((result._avg.rating ?? 0) * 10) / 10,
      count: result._count,
    };
  }

  /** Denormalised onto the listing so a card can show a rating without a join. */
  async updateAdRating(adId: string, average: number, count: number): Promise<void> {
    await this.db.ad.update({
      where: { id: adId },
      data: { ratingAverage: average, ratingCount: count },
    });
  }
}
