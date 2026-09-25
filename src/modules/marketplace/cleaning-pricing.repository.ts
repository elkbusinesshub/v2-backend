import { Inject, Injectable } from '@nestjs/common';
import type { CleaningPrice } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

@Injectable()
export class CleaningPricingRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async list(): Promise<CleaningPrice[]> {
    return this.db.cleaningPrice.findMany({ orderBy: { subCategory: 'asc' } });
  }

  async find(subCategory: string): Promise<CleaningPrice | null> {
    return this.db.cleaningPrice.findUnique({ where: { subCategory } });
  }

  async upsert(
    subCategory: string,
    hourlyRate: number,
    materialsFee: number,
  ): Promise<CleaningPrice> {
    return this.db.cleaningPrice.upsert({
      where: { subCategory },
      create: { subCategory, hourlyRate, materialsFee },
      update: { hourlyRate, materialsFee },
    });
  }
}
