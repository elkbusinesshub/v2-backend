import { Injectable, Logger } from '@nestjs/common';
import { AdStatus, Prisma, Role } from '@prisma/client';
import {
  ForbiddenResourceException,
  ResourceNotFoundException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { ImageService } from '@/storage/image.service';
import { validateAdAttributes } from './ad-attributes';
import type { AdDto, CreateAdDto, UpdateAdDto } from './marketplace.dto';
import { MarketplaceRepository, type AdWithSeller } from './marketplace.repository';

/** How many cards the home rail asks for when it does not say. */
export const DEFAULT_TOP_SELLERS = 10;

/**
 * Shown on a card until the seller uploads a photo.
 *
 * Set here rather than left to the column default, which MySQL stores as `?`:
 * the emoji does not survive the DDL path Prisma writes it through, so an ad
 * created without an icon rendered a broken glyph. Writing it as data works —
 * the column is utf8mb4 and the seeded icons come through the same way.
 */
const DEFAULT_AD_ICON = '🛍️';

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

  // ─── seller-owned listings ────────────────────────────────────────────────

  /**
   * The caller's own ads, drafts and paused ones included.
   *
   * `isWishlisted` is still resolved against the caller, so a seller who saved
   * their own ad sees it as saved rather than as a blank heart.
   */
  async myAds(user: AuthUser, status?: AdStatus): Promise<AdDto[]> {
    return this.decorate(await this.ads.findBySeller(user.id, status), user.id);
  }

  async create(user: AuthUser, dto: CreateAdDto): Promise<AdDto> {
    const attributes = validateAdAttributes(dto.categorySlug, dto.attributes);
    const ad = await this.ads.create(
      user.id,
      {
        title: dto.title,
        description: dto.description ?? '',
        categorySlug: dto.categorySlug,
        price: dto.price,
        priceUnit: dto.priceUnit ?? '',
        icon: dto.icon || DEFAULT_AD_ICON,
        locality: dto.locality ?? null,
        city: dto.city ?? null,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        attributes: attributes ?? Prisma.DbNull,
        // "Save draft" and "Publish ad" are the two buttons on the sheet.
        status: dto.status ?? AdStatus.ACTIVE,
      },
      dto.imageKeys ?? [],
    );
    const [created] = await this.decorate([ad], user.id);
    return created!;
  }

  async update(user: AuthUser, id: string, dto: UpdateAdDto): Promise<AdDto> {
    const existing = await this.assertCanManage(user, id);

    // Attributes are only meaningful next to a category, so they are validated
    // against the one the ad will have once this update lands — not the one it
    // has now.
    const category = dto.categorySlug ?? existing.categorySlug;
    const recategorised =
      dto.categorySlug !== undefined && dto.categorySlug !== existing.categorySlug;
    const attributes =
      dto.attributes !== undefined
        ? validateAdAttributes(category, dto.attributes)
        : // Details describing a rental make no sense on a cleaning ad, so
          // moving an ad between categories drops whatever it was carrying.
          recategorised
          ? null
          : undefined;

    const ad = await this.ads.update(
      id,
      {
        // Every field is optional, so only send what the seller actually
        // changed — spreading undefined would blank columns.
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.categorySlug !== undefined ? { categorySlug: dto.categorySlug } : {}),
        ...(dto.price !== undefined ? { price: dto.price } : {}),
        ...(dto.priceUnit !== undefined ? { priceUnit: dto.priceUnit } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
        ...(dto.locality !== undefined ? { locality: dto.locality } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.lat !== undefined ? { lat: dto.lat } : {}),
        ...(dto.lng !== undefined ? { lng: dto.lng } : {}),
        ...(attributes !== undefined ? { attributes: attributes ?? Prisma.DbNull } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      dto.imageKeys,
    );
    const [updated] = await this.decorate([ad], user.id);
    return updated!;
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    await this.assertCanManage(user, id);
    await this.ads.softDelete(id);
  }

  /**
   * Owner-or-admin, matching how ElkStay guards provider listings. A 404 for a
   * missing ad, a 403 for someone else's — the ad's existence is not a secret
   * once it has been published.
   */
  private async assertCanManage(user: AuthUser, id: string): Promise<AdWithSeller> {
    const ad = await this.ads.findOwned(id);
    if (!ad) {
      throw new ResourceNotFoundException('Ad');
    }
    if (!user.roles.includes(Role.ADMIN) && ad.sellerId !== user.id) {
      throw new ForbiddenResourceException('You can only manage your own listings');
    }
    // Returned so an update can read the ad's current category without a
    // second round trip.
    return ad;
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
        ratingAverage: Number(ad.ratingAverage),
        ratingCount: ad.ratingCount,
        isWishlisted: wishlisted.has(ad.id),
        status: ad.status,
        imageUrls: await this.imageUrls(ad),
        // Prisma types a nullable Json column as JsonValue, which includes the
        // literal null the column never holds — everything written here is
        // either an object or SQL NULL.
        attributes: (ad.attributes as Record<string, unknown> | null) ?? null,
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
