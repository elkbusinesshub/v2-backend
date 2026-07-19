import { Inject, Injectable } from '@nestjs/common';
import type {
  Prisma,
  RentalBranch,
  RentalCar,
  RentalCarCategory,
  RentalExtra,
  RentalPromo,
} from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

export interface CarListFilters {
  category?: RentalCarCategory;
  skip: number;
  take: number;
}

@Injectable()
export class RentalCarsRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async list(f: CarListFilters): Promise<{ items: RentalCar[]; total: number }> {
    const where: Prisma.RentalCarWhereInput = f.category ? { category: f.category } : {};
    const [items, total] = await Promise.all([
      this.db.rentalCar.findMany({
        where,
        // "Sort: Price" — ascending, ties by name
        orderBy: [{ pricePerDay: 'asc' }, { name: 'asc' }],
        skip: f.skip,
        take: f.take,
      }),
      this.db.rentalCar.count({ where }),
    ]);
    return { items, total };
  }

  /** findFirst so the soft-delete filter applies. */
  async findById(id: string): Promise<RentalCar | null> {
    return this.db.rentalCar.findFirst({ where: { id } });
  }

  /** Includes soft-deleted rows on purpose — a deleted car still owns its slug. */
  async findBySlug(slug: string): Promise<RentalCar | null> {
    return this.db.rentalCar.findUnique({ where: { slug } });
  }

  async create(
    providerId: string,
    slug: string,
    data: Omit<Prisma.RentalCarUncheckedCreateInput, 'slug' | 'providerId'>,
  ): Promise<RentalCar> {
    return this.db.rentalCar.create({ data: { ...data, slug, providerId } });
  }

  async update(id: string, data: Prisma.RentalCarUncheckedUpdateInput): Promise<RentalCar> {
    return this.db.rentalCar.update({ where: { id }, data });
  }

  /** Soft delete via the client extension. */
  async softDelete(id: string): Promise<void> {
    await this.db.rentalCar.delete({ where: { id } });
  }

  // ─── catalog lookups ───────────────────────────────────────────────────────

  async listBranches(): Promise<RentalBranch[]> {
    return this.db.rentalBranch.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async findBranchById(id: string): Promise<RentalBranch | null> {
    return this.db.rentalBranch.findUnique({ where: { id } });
  }

  async listActiveExtras(): Promise<RentalExtra[]> {
    return this.db.rentalExtra.findMany({
      where: { isActive: true },
      orderBy: { pricePerDay: 'desc' },
    });
  }

  async findActiveExtrasByKeys(keys: string[]): Promise<RentalExtra[]> {
    if (keys.length === 0) return [];
    return this.db.rentalExtra.findMany({ where: { key: { in: keys }, isActive: true } });
  }

  async findActivePromo(code: string): Promise<RentalPromo | null> {
    return this.db.rentalPromo.findFirst({ where: { code, isActive: true } });
  }
}
