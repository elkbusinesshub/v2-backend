import { Test } from '@nestjs/testing';
import { Prisma, Role } from '@prisma/client';
import { LocationsRepository } from '@/modules/locations/locations.repository';
import { HomeService } from '@/modules/home/home.service';
import { MarketplaceService } from '@/modules/marketplace/marketplace.service';
import { UsersRepository } from '@/modules/users/users.repository';

const user = {
  id: 'u-1',
  phone: '+971500000001',
  email: null,
  name: 'Ahmed',
  roles: [Role.USER],
  language: 'en',
  rewardPoints: 0,
  walletBalance: new Prisma.Decimal(0),
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

describe('HomeService', () => {
  let service: HomeService;
  let users: jest.Mocked<UsersRepository>;
  let locations: jest.Mocked<LocationsRepository>;
  let marketplace: jest.Mocked<MarketplaceService>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HomeService,
        { provide: UsersRepository, useValue: { findById: jest.fn().mockResolvedValue(user) } },
        {
          provide: LocationsRepository,
          useValue: { findDefaultForUser: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: MarketplaceService,
          useValue: {
            topSellers: jest.fn().mockResolvedValue([
              {
                id: 'ad-1',
                sellerName: 'Royal Shine Cleaning Co.',
                categorySlug: 'cleaning',
                price: 85,
              },
            ]),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(HomeService);
    users = moduleRef.get(UsersRepository);
    locations = moduleRef.get(LocationsRepository);
    marketplace = moduleRef.get(MarketplaceService);
  });

  it('assembles greeting, nav tiles, promo, and best sellers', async () => {
    locations.findDefaultForUser.mockResolvedValue({
      id: 'addr-1',
      userId: 'u-1',
      label: 'Home',
      formattedAddress: 'Koramangala',
      lat: 24.45,
      lng: 54.37,
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    const feed = await service.getFeed('u-1');

    expect(feed.userName).toBe('Ahmed');
    expect(feed.location).toBe('Home');
    // The header shows the address; the label alone does not tell the user
    // which of their saved addresses is selected.
    expect(feed.locationAddress).toBe('Koramangala');
    expect(feed.promo.title).toContain('20% OFF');
    expect(feed.categories).toHaveLength(6);
    expect(feed.categories.map((c) => c.id)).toEqual([
      'taxi',
      'elkstay',
      'cleaning',
      'car_rental',
      'repair',
      'porter',
    ]);
    // Both rails read the same ranking now. They used to disagree — this one
    // read the seeded catalogue while the rail below it read seller listings.
    expect(feed.bestSellers).toEqual([
      {
        id: 'ad-1',
        name: 'Royal Shine Cleaning Co.',
        initials: 'RS',
        category: 'cleaning · ₹85',
        priceLabel: '₹85',
        // Nothing rates or verifies a listing yet, so nothing claims either.
        rating: 0,
        colorHex: 0xfffef3c7,
        verified: false,
      },
    ]);
  });

  it('falls back to empty strings for a fresh user with no name or address', async () => {
    users.findById.mockResolvedValue({ ...user, name: null });
    marketplace.topSellers.mockResolvedValue([]);

    const feed = await service.getFeed('u-1');

    expect(feed.userName).toBe('');
    expect(feed.location).toBe('');
    expect(feed.locationAddress).toBe('');
    expect(feed.bestSellers).toEqual([]);
  });

  it('embeds the engagement-ranked seller ads in the feed', async () => {
    marketplace.topSellers.mockResolvedValue([
      {
        id: 'ad-1',
        title: 'Deep Home Cleaning',
        sellerName: 'Bright Spark',
        categorySlug: 'cleaning',
        price: 85,
        wishlistCount: 4,
        viewCount: 30,
      } as never,
    ]);

    const feed = await service.getFeed('u-1');

    // The rail is above the fold, so it has to ride along on the one call the
    // home screen already makes rather than costing a second round trip.
    expect(marketplace.topSellers).toHaveBeenCalledWith('u-1', 10);
    expect(feed.topSellers).toHaveLength(1);
  });
});
