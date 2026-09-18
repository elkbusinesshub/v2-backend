import { Inject, Injectable } from '@nestjs/common';
import { AdStatus, type Prisma } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';
import type { AdWithSeller } from '@/modules/marketplace/marketplace.repository';
import { LISTING_CATEGORIES } from './listings.constants';

/** The shape `MarketplaceService.decorate` maps, so a listing is an ad card. */
const withSeller = {
  seller: {
    select: {
      name: true,
      phone: true,
      email: true,
      providerProfile: { select: { businessName: true, contactNumber: true } },
    },
  },
  images: { select: { key: true }, orderBy: { sortOrder: 'asc' } },
} satisfies Prisma.AdInclude;

export interface ListingFilters {
  category?: string;
  query?: string;
  minPrice?: number;
  maxPrice?: number;
  area?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class ListingsRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  /**
   * Published listings, newest first.
   *
   * Always scoped to the listing categories, so an ad from a booking vertical
   * never appears here even when no category filter is given.
   */
  async findPublished(filters: ListingFilters): Promise<AdWithSeller[]> {
    const { category, query, minPrice, maxPrice, area, limit, offset } = filters;
    const and: Prisma.AdWhereInput[] = [];
    if (query) {
      and.push({
        OR: [
          { title: { contains: query } },
          { seller: { name: { contains: query } } },
          { seller: { providerProfile: { businessName: { contains: query } } } },
        ],
      });
    }
    if (area) {
      and.push({ OR: [{ locality: { contains: area } }, { city: { contains: area } }] });
    }

    return this.db.ad.findMany({
      where: {
        status: AdStatus.ACTIVE,
        categorySlug: category ?? { in: [...LISTING_CATEGORIES] },
        ...(minPrice !== undefined || maxPrice !== undefined
          ? { price: { gte: minPrice, lte: maxPrice } }
          : {}),
        ...(and.length > 0 ? { AND: and } : {}),
      },
      // The id breaks ties so paging by offset never repeats or skips a row
      // created in the same millisecond.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit,
      include: withSeller,
    });
  }
}
