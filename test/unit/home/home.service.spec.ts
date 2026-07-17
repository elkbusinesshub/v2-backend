import { Test } from '@nestjs/testing';
import { Prisma, Role } from '@prisma/client';
import { LocationsRepository } from '@/modules/locations/locations.repository';
import { HomeService } from '@/modules/home/home.service';
import { ServicesRepository, ServiceWithCategory } from '@/modules/services/services.repository';
import { UsersRepository } from '@/modules/users/users.repository';

const user = {
  id: 'u-1',
  phone: '+971500000001',
  email: null,
  name: 'Ahmed',
  roles: [Role.USER],
  language: 'en',
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

const category = {
  id: 'cat-1',
  slug: 'cleaning',
  name: 'Cleaning',
  icon: '🧹',
  colorHex: 0xfffef3c7,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeService(overrides: Partial<ServiceWithCategory> = {}): ServiceWithCategory {
  return {
    id: 'svc-1',
    categoryId: category.id,
    slug: 'deep_cleaning',
    name: 'Deep Cleaning',
    icon: '✨',
    badge: null,
    description: 'desc',
    price: new Prisma.Decimal(85),
    priceUnit: '/ session',
    durationLabel: '2-3 hrs',
    teamSizeLabel: '2 People',
    included: [],
    providerName: 'Royal Shine Cleaning Co.',
    providerExperience: '12 years experience',
    rating: 4.9,
    reviewCount: 100,
    bookingsLabel: '1k+',
    createdAt: new Date(),
    updatedAt: new Date(),
    category,
    ...overrides,
  };
}

describe('HomeService', () => {
  let service: HomeService;
  let users: jest.Mocked<UsersRepository>;
  let locations: jest.Mocked<LocationsRepository>;
  let services: jest.Mocked<ServicesRepository>;

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
          provide: ServicesRepository,
          useValue: { findTopRated: jest.fn().mockResolvedValue([makeService()]) },
        },
      ],
    }).compile();

    service = moduleRef.get(HomeService);
    users = moduleRef.get(UsersRepository);
    locations = moduleRef.get(LocationsRepository);
    services = moduleRef.get(ServicesRepository);
  });

  it('assembles greeting, nav tiles, promo, and best sellers', async () => {
    locations.findDefaultForUser.mockResolvedValue({
      id: 'addr-1',
      userId: 'u-1',
      label: 'Home',
      formattedAddress: 'Marina Bay',
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
    expect(feed.bestSellers).toEqual([
      {
        id: 'svc-1',
        name: 'Royal Shine Cleaning Co.',
        initials: 'RS',
        category: 'Cleaning · AED 85',
        priceLabel: 'AED 85',
        rating: 4.9,
        colorHex: category.colorHex,
        verified: true,
      },
    ]);
  });

  it('falls back to empty strings for a fresh user with no name or address', async () => {
    users.findById.mockResolvedValue({ ...user, name: null });
    services.findTopRated.mockResolvedValue([]);

    const feed = await service.getFeed('u-1');

    expect(feed.userName).toBe('');
    expect(feed.location).toBe('');
    expect(feed.bestSellers).toEqual([]);
  });
});
