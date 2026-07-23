import { Inject, Injectable } from '@nestjs/common';
import type { Offer, Prisma } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

@Injectable()
export class OffersRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async listActive(): Promise<Offer[]> {
    return this.db.offer.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  }

  async create(data: Prisma.OfferUncheckedCreateInput): Promise<Offer> {
    return this.db.offer.create({ data });
  }
}
