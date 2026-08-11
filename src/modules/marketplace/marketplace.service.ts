import { Injectable, Logger } from '@nestjs/common';
import { ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import { ImageService } from '@/storage/image.service';
import type { AdDto } from './marketplace.dto';
import { MarketplaceRepository, type AdWithSeller } from './marketplace.repository';

/** How many cards the home rail asks for when it does not say. */
export const DEFAULT_TOP_SELLERS = 10;

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    private readonly ads: MarketplaceRepository,
    private readonly images: ImageService,
  ) {}

  /** Ads ranked by engagement — wishlists first, views breaking ties. */
  async topSellers(
    userId: string,
    limit = DEFAULT_TOP_SELLERS,
    categorySlug?: string,
  ): Promise<AdDto[]> {
    return this.decorate(await this.ads.findTopSellers(limit, categorySlug), userId);
  }

  async list(
    userId: string,
    params: { categorySlug?: string; query?: string; limit?: number },
  ): Promise<AdDto[]> {
    const rows = await this.ads.findAll({
      categorySlug: params.categorySlug,
      query: params.query,
      limit: params.limit ?? DEFAULT_TOP_SELLERS * 3,
    });
    return this.decorate(rows, userId);
  }

  /**
   * One ad, and the caller's view is recorded.
   *
   * The view is deliberately part of reading the detail: it is the only place
   * we can observe genuine interest, and `recordView` de-duplicates per user
   * so the counter cannot be farmed by reloading.
   */
  async detail(id: string, userId: string): Promise<AdDto> {
    const ad = await this.ads.findById(id);
    if (!ad) {
      throw new ResourceNotFoundException('Ad');
    }

    const firstView = await this.ads.recordView(id, userId);
    const [dto] = await this.decorate([ad], userId);
    // The row was read before the increment, so reflect it rather than
    // re-querying just to move one number.
    return { ...dto!, viewCount: ad.viewCount + (firstView ? 1 : 0) };
  }

  /** Saves or unsaves an ad. Returns the ad's new wishlist state. */
  async setWishlisted(
    id: string,
    userId: string,
    wishlisted: boolean,
  ): Promise<{ isWishlisted: boolean; wishlistCount: number }> {
    const ad = await this.ads.findById(id);
    if (!ad) {
      throw new ResourceNotFoundException('Ad');
    }

    const changed = wishlisted
      ? await this.ads.addToWishlist(id, userId)
      : await this.ads.removeFromWishlist(id, userId);

    return {
      isWishlisted: wishlisted,
      wishlistCount: ad.wishlistCount + (changed ? (wishlisted ? 1 : -1) : 0),
    };
  }

  /** Maps rows to cards, resolving image URLs and the caller's wishlist state. */
  private async decorate(rows: AdWithSeller[], userId: string): Promise<AdDto[]> {
    const wishlisted = await this.ads.wishlistedIds(
      userId,
      rows.map((r) => r.id),
    );

    return Promise.all(
      rows.map(async (ad) => ({
        id: ad.id,
        title: ad.title,
        description: ad.description,
        // The business name is what a buyer recognises; the personal name is
        // the fallback for a seller who never completed a provider profile.
        sellerName: ad.seller.providerProfile?.businessName ?? ad.seller.name ?? 'ELK Seller',
        categorySlug: ad.categorySlug,
        icon: ad.icon,
        price: Number(ad.price),
        priceUnit: ad.priceUnit,
        location: [ad.locality, ad.city].filter((p) => p && p.length > 0).join(', '),
        // Null for ads whose locality we have no coordinate for; the coverage
        // map then stays hidden rather than centring somewhere arbitrary.
        lat: ad.lat,
        lng: ad.lng,
        viewCount: ad.viewCount,
        wishlistCount: ad.wishlistCount,
        isWishlisted: wishlisted.has(ad.id),
        imageUrls: await this.imageUrls(ad),
      })),
    );
  }

  /**
   * Presigned URLs for an ad's photos.
   *
   * A storage hiccup must not blank the whole rail, so a failure degrades to
   * no images — the card still renders with its emoji.
   */
  private async imageUrls(ad: AdWithSeller): Promise<string[]> {
    if (ad.images.length === 0) return [];
    try {
      return await Promise.all(ad.images.map((i) => this.images.urlFor(i.key)));
    } catch (err) {
      this.logger.warn({ err, adId: ad.id }, 'could not presign ad images');
      return [];
    }
  }
}
