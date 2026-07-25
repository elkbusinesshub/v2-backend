import { Test } from '@nestjs/testing';
import { CleanBookingStatus, CleanPromoKind, Role } from '@prisma/client';
import {
  DomainException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { LocationsRepository } from '@/modules/locations/locations.repository';
import { UsersRepository } from '@/modules/users/users.repository';
import { CleanBookingsRepository } from '@/modules/elkclean/clean-bookings.repository';
import { CleanCatalogRepository } from '@/modules/elkclean/clean-catalog.repository';
import { ElkCleanService } from '@/modules/elkclean/elkclean.service';

const user: AuthUser = { id: 'u-1', roles: [Role.USER], jti: 'j', exp: 9999999999 };

const category = {
  id: 'cat-tnk',
  slug: 'tnk',
  code: 'TNK',
  label: 'Water Tank',
  blurb: 'Drain, scrub & disinfect',
  iconKey: 'ic_water_tank',
  badge: null,
  star: true,
  sortOrder: 2,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const sofaShampoo = {
  id: 'svc-sofa',
  code: 'SOF-01',
  categoryId: 'cat-sof',
  name: 'Sofa Shampoo (per seat)',
  description: 'Lift stains, odours & dust mites.',
  price: 35,
  durationLabel: '20 min/seat',
  tag: 'Popular',
  checklist: ['Pre-treat stains'],
  steps: null,
  isActive: true,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const tankClean = {
  ...sofaShampoo,
  id: 'svc-tank',
  code: 'TNK-01',
  categoryId: 'cat-tnk',
  name: 'Water Tank Cleaning – up to 1000L',
  price: 149,
  steps: ['Inspect', 'Drain'],
};

const address = {
  id: 'addr-1',
  userId: 'u-1',
  label: 'Home',
  formattedAddress: 'Tower 3, Apt 1204, Al Reem Island',
  lat: 24.5,
  lng: 54.4,
  isDefault: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

/** Tomorrow in the operating region (+04:00) as YYYY-MM-DD. */
function tomorrow(): string {
  return new Date(Date.now() + 4 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
}

describe('ElkCleanService', () => {
  let service: ElkCleanService;
  let catalog: jest.Mocked<CleanCatalogRepository>;
  let bookings: jest.Mocked<CleanBookingsRepository>;
  let locations: jest.Mocked<LocationsRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ElkCleanService,
        {
          provide: CleanCatalogRepository,
          useValue: {
            listCategories: jest.fn().mockResolvedValue([category]),
            findCategoryBySlug: jest.fn().mockResolvedValue(category),
            activeServiceCounts: jest.fn().mockResolvedValue({ 'cat-tnk': 3 }),
            listServicesByCategory: jest.fn().mockResolvedValue([tankClean]),
            findServiceById: jest.fn().mockResolvedValue(tankClean),
            findActiveServicesByIds: jest.fn().mockResolvedValue([sofaShampoo, tankClean]),
            findServiceByCode: jest.fn().mockResolvedValue(null),
            createService: jest.fn(),
            updateService: jest.fn(),
            listActiveOffers: jest.fn().mockResolvedValue([]),
            findActivePromo: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: CleanBookingsRepository,
          useValue: {
            create: jest.fn().mockImplementation(({ booking, items }) =>
              Promise.resolve({
                ...booking,
                id: 'b-1',
                items,
                cancelledAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
              }),
            ),
            listForUser: jest.fn().mockResolvedValue([]),
            findForUser: jest.fn(),
            findById: jest.fn(),
            cancel: jest.fn(),
            markCompleted: jest.fn(),
            codeExists: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: UsersRepository,
          useValue: { findById: jest.fn().mockResolvedValue({ name: 'Demo User' }) },
        },
        {
          provide: LocationsRepository,
          useValue: {
            findAllByUser: jest.fn().mockResolvedValue([address]),
            findByIdForUser: jest.fn().mockResolvedValue(address),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(ElkCleanService);
    catalog = moduleRef.get(CleanCatalogRepository);
    bookings = moduleRef.get(CleanBookingsRepository);
    locations = moduleRef.get(LocationsRepository);
  });

  const cart = {
    items: [
      { serviceId: 'svc-sofa', quantity: 4 },
      { serviceId: 'svc-tank', quantity: 1 },
    ],
  };

  describe('quote', () => {
    it('prices the cart server-side: lines + supply fee, no promo', async () => {
      const quote = await service.quote(cart);
      const breakdown = quote.breakdown as Record<string, number | null>;
      // 4×35 + 1×149 = 289, +10 supply fee
      expect(breakdown.subtotal).toBe(289);
      expect(breakdown.supplyFee).toBe(10);
      expect(breakdown.discountAmount).toBe(0);
      expect(breakdown.totalAmount).toBe(299);
    });

    it('applies a percentage promo to the service subtotal only', async () => {
      catalog.findActivePromo.mockResolvedValue({
        id: 'p-1',
        code: 'SOFA50',
        kind: CleanPromoKind.PERCENT,
        value: 50,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const quote = await service.quote({ ...cart, promoCode: 'sofa50' });
      const breakdown = quote.breakdown as Record<string, number | null>;
      // round(289×50%) = 145 off; fee not discounted
      expect(breakdown.discountAmount).toBe(145);
      expect(breakdown.totalAmount).toBe(289 - 145 + 10);
      expect(catalog.findActivePromo).toHaveBeenCalledWith('SOFA50');
    });

    it('caps a fixed promo at the subtotal', async () => {
      catalog.findActiveServicesByIds.mockResolvedValue([sofaShampoo]);
      catalog.findActivePromo.mockResolvedValue({
        id: 'p-2',
        code: 'DEEP70',
        kind: CleanPromoKind.FIXED,
        value: 70,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const quote = await service.quote({
        items: [{ serviceId: 'svc-sofa', quantity: 1 }],
        promoCode: 'DEEP70',
      });
      const breakdown = quote.breakdown as Record<string, number | null>;
      expect(breakdown.discountAmount).toBe(35); // capped, never negative
      expect(breakdown.totalAmount).toBe(10);
    });

    it('rejects unknown or inactive services', async () => {
      catalog.findActiveServicesByIds.mockResolvedValue([sofaShampoo]);
      await expect(service.quote(cart)).rejects.toBeInstanceOf(ValidationFailedException);
    });

    it('rejects an unknown promo code', async () => {
      await expect(service.quote({ ...cart, promoCode: 'NOPE' })).rejects.toBeInstanceOf(
        ValidationFailedException,
      );
    });
  });

  describe('createBooking', () => {
    const dto = {
      ...cart,
      scheduledDate: tomorrow(),
      timeSlot: '10:00',
      addressId: 'addr-1',
      paymentMethod: 'card',
    };

    it('creates a paid CONFIRMED booking with snapshots and an ELC code', async () => {
      const booking = await service.createBooking(user, dto);
      expect(booking.code).toMatch(/^ELC-\d{4}$/);
      expect(booking.status).toBe('confirmed');
      expect(booking.address).toEqual({
        label: 'Home',
        line: 'Tower 3, Apt 1204, Al Reem Island',
      });
      const breakdown = booking.breakdown as Record<string, number | null>;
      expect(breakdown.totalAmount).toBe(299);
      expect(booking.paidAt).not.toBeNull();

      const created = bookings.create.mock.calls[0]![0];
      expect(created.booking.status).toBe(CleanBookingStatus.CONFIRMED);
      expect(created.items).toHaveLength(2);
      expect(created.items[0]).toMatchObject({ unitPrice: 35, quantity: 4, lineTotal: 140 });
    });

    it('rejects a date outside the 6-day window', async () => {
      const far = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      await expect(
        service.createBooking(user, { ...dto, scheduledDate: far }),
      ).rejects.toBeInstanceOf(ValidationFailedException);
    });

    it("404s when the address isn't the caller's", async () => {
      locations.findByIdForUser.mockResolvedValue(null);
      await expect(service.createBooking(user, dto)).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });
  });

  describe('cancelBooking', () => {
    it('409s when inside the 2h cutoff (or already cancelled)', async () => {
      bookings.findForUser.mockResolvedValue({ id: 'b-1', code: 'ELC-1234' } as never);
      bookings.cancel.mockResolvedValue(false);
      await expect(service.cancelBooking(user, 'b-1')).rejects.toMatchObject({
        code: 'NOT_CANCELLABLE',
      });
    });

    it('404s for a booking the caller does not own', async () => {
      bookings.findForUser.mockResolvedValue(null);
      await expect(service.cancelBooking(user, 'b-x')).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });
  });

  describe('completeBooking', () => {
    it('409s unless the booking is CONFIRMED', async () => {
      bookings.findById.mockResolvedValue({ id: 'b-1', code: 'ELC-1234' } as never);
      bookings.markCompleted.mockResolvedValue(false);
      await expect(service.completeBooking('b-1')).rejects.toBeInstanceOf(DomainException);
    });
  });

  describe('browse', () => {
    it('serves the home feed with live category counts', async () => {
      const feed = await service.getHomeFeed(user);
      expect(feed.userName).toBe('Demo');
      const categories = feed.categories as Record<string, unknown>[];
      expect(categories[0]).toMatchObject({ id: 'tnk', star: true, serviceCount: 3 });
    });

    it('404s an inactive service detail', async () => {
      catalog.findServiceById.mockResolvedValue({ ...tankClean, isActive: false });
      await expect(service.getService('svc-tank')).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });
  });
});
