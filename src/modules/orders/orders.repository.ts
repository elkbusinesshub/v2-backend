import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

@Injectable()
export class OrdersRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  /**
   * An order against a listing, for the tracking screen.
   *
   * Visible to both sides: the buyer watching progress, and the seller
   * checking what they agreed to.
   */
  async findTrackableAdOrder(id: string, userId: string) {
    return this.db.adOrder.findFirst({
      where: { id, OR: [{ buyerId: userId }, { sellerId: userId }] },
      include: {
        ad: { select: { icon: true } },
        seller: { select: { id: true, name: true } },
      },
    });
  }
}
