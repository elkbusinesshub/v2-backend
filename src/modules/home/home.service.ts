import { Injectable } from '@nestjs/common';
import { initialsOf } from '@/common/utils/initials';
import { LocationsRepository } from '@/modules/locations/locations.repository';
import { MarketplaceService } from '@/modules/marketplace/marketplace.service';
import { UsersRepository } from '@/modules/users/users.repository';
import { BestSellerDto, HomeCategoryDto, HomeFeedDto, PromoBannerDto } from './home.dto';

const BEST_SELLER_COUNT = 3;

/** Cards in the home screen's engagement-ranked rail. */
const TOP_SELLER_COUNT = 10;

/**
 * Navigation tiles: the four listing-flow categories. Static config, not
 * catalog data — each id is the listing category slug the app opens the
 * marketplace on (see LISTING_CATEGORIES in the listings module).
 */
const HOME_CATEGORIES: HomeCategoryDto[] = [
  { id: 'listing_cleaning', name: 'Cleaning', icon: '🧹', colorHex: 0xfffef3c7 },
  { id: 'listing_stay', name: 'Stay', icon: '🏡', colorHex: 0xffe6efea },
  { id: 'listing_repair', name: 'Repair', icon: '🔧', colorHex: 0xfffce7f3 },
  { id: 'listing_tool_rental', name: 'Rentals', icon: '🧰', colorHex: 0xffede9fe },
];

/** Static until a promo/campaign engine exists. */
const PROMO: PromoBannerDto = {
  title: '20% OFF First Booking',
  subtitle: 'New users get exclusive discount on all services',
  ctaLabel: 'Claim Offer →',
  tag: 'NEW',
  icon: '🎁',
};

@Injectable()
export class HomeService {
  constructor(
    private readonly users: UsersRepository,
    private readonly locations: LocationsRepository,
    private readonly marketplace: MarketplaceService,
  ) {}

  async getFeed(userId: string): Promise<HomeFeedDto> {
    const [user, address, topSellers] = await Promise.all([
      this.users.findById(userId),
      this.locations.findDefaultForUser(userId),
      // Seller ads ranked by engagement. Embedded here so the home screen
      // still makes one call — the rail is above the fold.
      this.marketplace.topSellers(userId, TOP_SELLER_COUNT),
    ]);

    // Both rails now come from the same ranking. They used to disagree: this
    // one read the seeded `services` catalogue while the rail below it read
    // seller listings, so the home screen recommended two different things
    // under two headings. Same listings, two projections.
    const bestSellers = topSellers.slice(0, BEST_SELLER_COUNT).map((ad): BestSellerDto => ({
      id: ad.id,
      name: ad.sellerName,
      initials: initialsOf(ad.sellerName),
      category: `${ad.categorySlug} · ₹${ad.price}`,
      priceLabel: `₹${ad.price}`,
      // No listing carries a rating yet — no reviews reach one.
      rating: 0,
      // The tile colour of the category the listing sits in, so the card
      // matches the grid above it.
      colorHex:
        HOME_CATEGORIES.find((c) => c.id === ad.categorySlug)?.colorHex ??
        HOME_CATEGORIES[0]!.colorHex,
      // Verification was an admin flag on the seeded catalogue; nothing
      // grants it to a seller, so nothing claims it.
      verified: false,
    }));

    return {
      userName: user?.name ?? '',
      location: address?.label ?? '',
      locationAddress: address?.formattedAddress ?? '',
      promo: PROMO,
      categories: HOME_CATEGORIES,
      bestSellers,
      topSellers,
    };
  }
}
