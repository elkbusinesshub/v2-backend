import { Inject, Injectable } from '@nestjs/common';
import type { RepairPrice } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

@Injectable()
export class RepairPricingRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async list(): Promise<RepairPrice[]> {
    return this.db.repairPrice.findMany({ orderBy: { subCategory: 'asc' } });
  }

  async find(subCategory: string): Promise<RepairPrice | null> {
    return this.db.repairPrice.findUnique({ where: { subCategory } });
  }

  async upsert(subCategory: string, hourlyRate: number, partsFee: number): Promise<RepairPrice> {
    return this.db.repairPrice.upsert({
      where: { subCategory },
      create: { subCategory, hourlyRate, partsFee },
      update: { hourlyRate, partsFee },
    });
  }
}
