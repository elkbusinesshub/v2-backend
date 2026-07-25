import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, Review } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

@Injectable()
export class ReviewsRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async findByBookingId(bookingId: string): Promise<Review | null> {
    return this.db.review.findUnique({ where: { bookingId } });
  }

  async create(data: Prisma.ReviewUncheckedCreateInput): Promise<Review> {
    return this.db.review.create({ data });
  }

  /** Average rating (1 decimal) + count across every review for a service's bookings. */
  async aggregateForService(serviceId: string): Promise<{ average: number; count: number }> {
    const result = await this.db.review.aggregate({
      where: { booking: { serviceId } },
      _avg: { rating: true },
      _count: true,
    });
    return {
      average: Math.round((result._avg.rating ?? 0) * 10) / 10,
      count: result._count,
    };
  }
}
