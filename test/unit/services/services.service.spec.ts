import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import { LocationsRepository } from '@/modules/locations/locations.repository';
import { ServicesRepository, ServiceWithCategory } from '@/modules/services/services.repository';
import { ServicesService } from '@/modules/services/services.service';

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
    badge: 'BEST DEAL',
    description: 'Professional deep cleaning.',
    price: new Prisma.Decimal(149),
    priceUnit: '/ session',
    durationLabel: '3-4 hrs',
    teamSizeLabel: '2 People',
    included: ['Kitchen', 'Bathrooms'],
    providerName: 'Royal Shine Services',
    providerExperience: '12 years experience',
    rating: 4.9,
    reviewCount: 284,
    bookingsLabel: '1.2k+',
    createdAt: new Date(),
    updatedAt: new Date(),
    category,
    ...overrides,
  };
}

describe('ServicesService', () => {
  let service: ServicesService;
  let services: jest.Mocked<ServicesRepository>;
  let locations: jest.Mocked<LocationsRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ServicesService,
        {
          provide: ServicesRepository,
          useValue: { findAllGrouped: jest.fn(), findById: jest.fn() },
        },
        {
          provide: LocationsRepository,
          useValue: { findDefaultForUser: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = moduleRef.get(ServicesService);
    services = moduleRef.get(ServicesRepository);
    locations = moduleRef.get(LocationsRepository);
  });

  describe('listGroups', () => {
    it('maps categories to groups and drops empty categories', async () => {
      const svc = makeService();
      services.findAllGrouped.mockResolvedValue([
        { ...category, services: [svc] },
        { ...category, id: 'cat-2', slug: 'empty', name: 'Empty', services: [] },
      ]);

      const groups = await service.listGroups();

      expect(groups).toEqual([
        {
          title: 'Cleaning',
          icon: '🧹',
          items: [{ id: 'svc-1', name: 'Deep Cleaning', icon: '✨' }],
        },
      ]);
    });
  });

  describe('getDetail', () => {
    it('maps the row to the detail shape (initials, numeric price, included list)', async () => {
      services.findById.mockResolvedValue(makeService());

      const detail = await service.getDetail('svc-1');

      expect(detail).toMatchObject({
        id: 'svc-1',
        title: 'Deep Cleaning',
        badge: 'BEST DEAL',
        providerInitials: 'RS',
        category: 'Cleaning',
        included: ['Kitchen', 'Bathrooms'],
        price: 149,
      });
    });

    it('maps a missing badge to an empty string', async () => {
      services.findById.mockResolvedValue(makeService({ badge: null }));

      const detail = await service.getDetail('svc-1');

      expect(detail.badge).toBe('');
    });

    it('404s for an unknown service', async () => {
      services.findById.mockResolvedValue(null);

      await expect(service.getDetail('ghost')).rejects.toBeInstanceOf(ResourceNotFoundException);
    });
  });

  describe('getBookingOptions', () => {
    it('generates 5 upcoming dates starting tomorrow, with all slots available', async () => {
      services.findById.mockResolvedValue(makeService());

      const options = await service.getBookingOptions('svc-1', 'u-1');

      expect(options.dates).toHaveLength(5);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      expect(options.dates[0]!.day).toBe(tomorrow.getDate());
      expect(options.timeSlots.every((s) => s.available)).toBe(true);
    });

    it("prefills the user's default address and prices without promo", async () => {
      services.findById.mockResolvedValue(makeService());
      locations.findDefaultForUser.mockResolvedValue({
        id: 'addr-1',
        userId: 'u-1',
        label: 'Home',
        formattedAddress: 'Tower 3, Marina Bay',
        lat: 24.45,
        lng: 54.37,
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });

      const options = await service.getBookingOptions('svc-1', 'u-1');

      expect(options.address).toBe('Tower 3, Marina Bay');
      expect(options.pricing).toEqual({
        serviceFee: 149,
        promoCode: null,
        promoDiscount: 0,
        total: 149,
      });
    });

    it('falls back to an empty address when the user has none saved', async () => {
      services.findById.mockResolvedValue(makeService());

      const options = await service.getBookingOptions('svc-1', 'u-1');

      expect(options.address).toBe('');
    });
  });
});
