import { Inject, Injectable } from '@nestjs/common';
import type { CleanCategory, CleanOffer, CleanPromo, CleanService, Prisma } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

@Injectable()
export class CleanCatalogRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  // ─── categories ────────────────────────────────────────────────────────────

  async listCategories(): Promise<CleanCategory[]> {
    return this.db.cleanCategory.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async findCategoryBySlug(slug: string): Promise<CleanCategory | null> {
    return this.db.cleanCategory.findUnique({ where: { slug } });
  }

  /** Active-service count per category id (home grid subtitle). */
  async activeServiceCounts(): Promise<Record<string, number>> {
    const groups = await this.db.cleanService.groupBy({
      by: ['categoryId'],
      where: { isActive: true },
      _count: { _all: true },
    });
    return Object.fromEntries(groups.map((g) => [g.categoryId, g._count._all]));
  }

  // ─── services ──────────────────────────────────────────────────────────────

  async listServicesByCategory(categoryId: string): Promise<CleanService[]> {
    return this.db.cleanService.findMany({
      where: { categoryId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  async findServiceById(id: string): Promise<CleanService | null> {
    return this.db.cleanService.findUnique({ where: { id } });
  }

  async findActiveServicesByIds(ids: string[]): Promise<CleanService[]> {
    if (ids.length === 0) return [];
    return this.db.cleanService.findMany({ where: { id: { in: ids }, isActive: true } });
  }

  async findServiceByCode(code: string): Promise<CleanService | null> {
    return this.db.cleanService.findUnique({ where: { code } });
  }

  async createService(data: Prisma.CleanServiceUncheckedCreateInput): Promise<CleanService> {
    return this.db.cleanService.create({ data });
  }

  async updateService(
    id: string,
    data: Prisma.CleanServiceUncheckedUpdateInput,
  ): Promise<CleanService> {
    return this.db.cleanService.update({ where: { id }, data });
  }

  // ─── offers & promos ───────────────────────────────────────────────────────

  async listActiveOffers(): Promise<CleanOffer[]> {
    return this.db.cleanOffer.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findActivePromo(code: string): Promise<CleanPromo | null> {
    return this.db.cleanPromo.findFirst({ where: { code, isActive: true } });
  }
}
