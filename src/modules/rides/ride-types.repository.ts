import { Inject, Injectable } from '@nestjs/common';
import type { RideType } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

@Injectable()
export class RideTypesRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async listActive(): Promise<RideType[]> {
    return this.db.rideType.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  }

  async findActiveBySlug(slug: string): Promise<RideType | null> {
    return this.db.rideType.findFirst({ where: { slug, isActive: true } });
  }
}
