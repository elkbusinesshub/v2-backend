import { Inject, Injectable } from '@nestjs/common';
import { AdOrderStatus, type AdOrder, type Prisma } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

export type AdOrderRow = AdOrder & {
  buyer: { name: string | null; phone: string | null };
  ad: { icon: string; title: string };
};

const withParties = {
  buyer: { select: { name: true, phone: true } },
  ad: { select: { icon: true, title: true } },
} satisfies Prisma.AdOrderInclude;

@Injectable()
export class AdOrdersRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async create(data: Prisma.AdOrderUncheckedCreateInput): Promise<AdOrderRow> {
    return this.db.adOrder.create({ data, include: withParties });
  }

  /** Orders a seller has received, newest first. */
  async findForSeller(sellerId: string, status?: AdOrderStatus): Promise<AdOrderRow[]> {
    return this.db.adOrder.findMany({
      where: { sellerId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: withParties,
    });
  }

  /** Orders a buyer has placed, newest first. */
  async findForBuyer(buyerId: string, status?: AdOrderStatus): Promise<AdOrderRow[]> {
    return this.db.adOrder.findMany({
      where: { buyerId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: withParties,
    });
  }

  async findById(id: string): Promise<AdOrderRow | null> {
    return this.db.adOrder.findUnique({ where: { id }, include: withParties });
  }

  async updateStatus(
    id: string,
    status: AdOrderStatus,
    stamps: Partial<Pick<AdOrder, 'acceptedAt' | 'completedAt' | 'cancelledAt'>>,
  ): Promise<AdOrderRow> {
    return this.db.adOrder.update({
      where: { id },
      data: { status, ...stamps },
      include: withParties,
    });
  }

  /** Per-status tallies for the seller's order tabs, in one query. */
  async countsForSeller(sellerId: string): Promise<Record<AdOrderStatus, number>> {
    const rows = await this.db.adOrder.groupBy({
      by: ['status'],
      where: { sellerId },
      _count: { _all: true },
    });
    const counts = {
      [AdOrderStatus.NEW]: 0,
      [AdOrderStatus.IN_PROGRESS]: 0,
      [AdOrderStatus.COMPLETED]: 0,
      [AdOrderStatus.CANCELLED]: 0,
    };
    for (const row of rows) counts[row.status] = row._count._all;
    return counts;
  }
}
