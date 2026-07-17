import { Injectable } from '@nestjs/common';
import { initialsOf } from '@/common/utils/initials';
import { LocationsRepository } from '@/modules/locations/locations.repository';
import { ServicesRepository } from '@/modules/services/services.repository';
import { UsersRepository } from '@/modules/users/users.repository';
import { BestSellerDto, HomeCategoryDto, HomeFeedDto, PromoBannerDto } from './home.dto';

const BEST_SELLER_COUNT = 3;

/**
 * Navigation tiles for the verticals. Static config, not catalog data — each
 * id routes to its own app section (and, later, its own backend module).
 */
const HOME_CATEGORIES: HomeCategoryDto[] = [
  { id: 'taxi', name: 'Taxi / Ride', icon: '🚕', colorHex: 0xffe0f7f5 },
  { id: 'elkstay', name: 'ELK Stay', icon: '🏨', colorHex: 0xffe6efea },
  { id: 'cleaning', name: 'Cleaning', icon: '🧹', colorHex: 0xfffef3c7 },
  { id: 'car_rental', name: 'Car Rental', icon: '🚗', colorHex: 0xffede9fe },
  { id: 'repair', name: 'Repair', icon: '🔧', colorHex: 0xfffce7f3 },
  { id: 'porter', name: 'Porter', icon: '📦', colorHex: 0xffd1fae5 },
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
    private readonly services: ServicesRepository,
  ) {}

  async getFeed(userId: string): Promise<HomeFeedDto> {
    const [user, address, topRated] = await Promise.all([
      this.users.findById(userId),
      this.locations.findDefaultForUser(userId),
      this.services.findTopRated(BEST_SELLER_COUNT),
    ]);

    const bestSellers = topRated.map((s): BestSellerDto => ({
      id: s.id,
      name: s.providerName,
      initials: initialsOf(s.providerName),
      category: `${s.category.name} · AED ${s.price.toNumber()}`,
      priceLabel: `AED ${s.price.toNumber()}`,
      rating: s.rating,
      colorHex: s.category.colorHex,
      verified: true,
    }));

    return {
      userName: user?.name ?? '',
      location: address?.label ?? '',
      promo: PROMO,
      categories: HOME_CATEGORIES,
      bestSellers,
    };
  }
}
