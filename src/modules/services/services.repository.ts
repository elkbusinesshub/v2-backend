import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, Service, ServiceCategory } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

export type CategoryWithServices = ServiceCategory & { services: Service[] };
export type ServiceWithCategory = Prisma.ServiceGetPayload<{ include: { category: true } }>;

@Injectable()
export class ServicesRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async findAllGrouped(): Promise<CategoryWithServices[]> {
    return this.db.serviceCategory.findMany({
      orderBy: { createdAt: 'asc' },
      include: { services: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async findById(id: string): Promise<ServiceWithCategory | null> {
    return this.db.service.findFirst({ where: { id }, include: { category: true } });
  }

  /** Highest-rated services, one per provider — the home "best sellers" rail. */
  async findTopRated(limit: number): Promise<ServiceWithCategory[]> {
    const services = await this.db.service.findMany({
      orderBy: { rating: 'desc' },
      include: { category: true },
    });
    const seen = new Set<string>();
    return services
      .filter((s) => !seen.has(s.providerName) && Boolean(seen.add(s.providerName)))
      .slice(0, limit);
  }

  /** Overwrites the seeded display rating/count with a real review aggregate. */
  async updateRatingAggregate(id: string, rating: number, reviewCount: number): Promise<void> {
    await this.db.service.update({ where: { id }, data: { rating, reviewCount } });
  }
}
