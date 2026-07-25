import { Inject, Injectable } from '@nestjs/common';
import type {
  Prisma,
  RepairCategory,
  RepairOffer,
  RepairPromo,
  RepairService,
} from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

@Injectable()
export class RepairCatalogRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  // ─── categories ────────────────────────────────────────────────────────────

  async listCategories(): Promise<RepairCategory[]> {
    return this.db.repairCategory.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async findCategoryBySlug(slug: string): Promise<RepairCategory | null> {
    return this.db.repairCategory.findUnique({ where: { slug } });
  }

  /** Active-service count per category id (home grid subtitle). */
  async activeServiceCounts(): Promise<Record<string, number>> {
    const groups = await this.db.repairService.groupBy({
      by: ['categoryId'],
      where: { isActive: true },
      _count: { _all: true },
    });
    return Object.fromEntries(groups.map((g) => [g.categoryId, g._count._all]));
  }

  // ─── services ──────────────────────────────────────────────────────────────

  async listServicesByCategory(categoryId: string): Promise<RepairService[]> {
    return this.db.repairService.findMany({
      where: { categoryId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  async findServiceById(id: string): Promise<RepairService | null> {
    return this.db.repairService.findUnique({ where: { id } });
  }

  async findActiveServicesByIds(ids: string[]): Promise<RepairService[]> {
    if (ids.length === 0) return [];
    return this.db.repairService.findMany({ where: { id: { in: ids }, isActive: true } });
  }

  async findServiceByCode(code: string): Promise<RepairService | null> {
    return this.db.repairService.findUnique({ where: { code } });
  }

  async createService(data: Prisma.RepairServiceUncheckedCreateInput): Promise<RepairService> {
    return this.db.repairService.create({ data });
  }

  async updateService(
    id: string,
    data: Prisma.RepairServiceUncheckedUpdateInput,
  ): Promise<RepairService> {
    return this.db.repairService.update({ where: { id }, data });
  }

  // ─── offers & promos ───────────────────────────────────────────────────────

  async listActiveOffers(): Promise<RepairOffer[]> {
    return this.db.repairOffer.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findActivePromo(code: string): Promise<RepairPromo | null> {
    return this.db.repairPromo.findFirst({ where: { code, isActive: true } });
  }
}
