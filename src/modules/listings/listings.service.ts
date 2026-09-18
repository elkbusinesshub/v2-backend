import { Injectable } from '@nestjs/common';
import { AdStatus } from '@prisma/client';
import { ValidationFailedException } from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import type { AdDto } from '@/modules/marketplace/marketplace.dto';
import { MarketplaceService } from '@/modules/marketplace/marketplace.service';
import { DEFAULT_LISTINGS_PAGE } from './listings.constants';
import type { CreateListingDto, ListingsQueryDto } from './listings.dto';
import { ListingsRepository } from './listings.repository';

/**
 * The listing flow: a seller publishes, buyers browse and filter, then contact
 * the seller directly.
 *
 * A listing is stored as an ad, so everything after creation — the detail read
 * with contact details, editing, pausing, deleting, photos — is the
 * marketplace's existing endpoints. This module adds only what the flow needs
 * that those do not: its own categories, and filters.
 */
@Injectable()
export class ListingsService {
  constructor(
    private readonly listings: ListingsRepository,
    private readonly marketplace: MarketplaceService,
  ) {}

  async browse(user: AuthUser, query: ListingsQueryDto): Promise<AdDto[]> {
    if (
      query.minPrice !== undefined &&
      query.maxPrice !== undefined &&
      query.minPrice > query.maxPrice
    ) {
      throw new ValidationFailedException([
        { field: 'minPrice', message: 'minPrice cannot be more than maxPrice' },
      ]);
    }

    const rows = await this.listings.findPublished({
      category: query.category,
      query: query.q,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      area: query.area,
      limit: query.limit ?? DEFAULT_LISTINGS_PAGE,
      offset: query.offset ?? 0,
    });
    return this.marketplace.decorate(rows, user.id);
  }

  /** Published straight away — the flow has no drafts. */
  async create(user: AuthUser, dto: CreateListingDto): Promise<AdDto> {
    return this.marketplace.create(user, {
      title: dto.title,
      categorySlug: dto.categorySlug,
      price: dto.price,
      description: dto.description,
      locality: dto.locality,
      city: dto.city,
      imageKeys: dto.imageKeys,
      status: AdStatus.ACTIVE,
    });
  }
}
