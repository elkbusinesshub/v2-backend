import { Test } from '@nestjs/testing';
import { RepairBookingStatus, RepairPromoKind, Role } from '@prisma/client';
import {
  DomainException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { LocationsRepository } from '@/modules/locations/locations.repository';
import { UsersRepository } from '@/modules/users/users.repository';
import { RepairBookingsRepository } from '@/modules/repair/repair-bookings.repository';
import { RepairCatalogRepository } from '@/modules/repair/repair-catalog.repository';
import { ElkRepService } from '@/modules/repair/repair.service';

const user: AuthUser = { id: 'u-1', roles: [Role.USER], jti: 'j', exp: 9999999999 };

const category = {
  id: 'cat-ac',
  slug: 'ac',
  code: 'AC',
  label: 'AC & Cooling',
  blurb: 'Service, gas, deep clean',
  iconKey: 'ic_ac',
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const acService = {
  id: 'svc-ac',
  code: 'AC-01',
  categoryId: 'cat-ac',
  name: 'AC General Service',
  description: 'Coil clean, filter wash, performance check.',
  price: 89,
  durationLabel: '45–60 min',
  tag: 'Popular',
  isActive: true,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const plmService = {
  ...acService,
  id: 'svc-plm',
  code: 'PLM-01',
  categoryId: 'cat-plm',
  name: 'Tap / Mixer Repair',
  price: 69,
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

describe('ElkRepService', () => {
  let service: ElkRepService;
  let catalog: jest.Mocked<RepairCatalogRepository>;
  let bookings: jest.Mocked<RepairBookingsRepository>;
  let locations: jest.Mocked<LocationsRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ElkRepService,
        {
          provide: RepairCatalogRepository,
          useValue: {
            listCategories: jest.fn().mockResolvedValue([category]),
            findCategoryBySlug: jest.fn().mockResolvedValue(category),
            activeServiceCounts: jest.fn().mockResolvedValue({ 'cat-ac': 4 }),
            listServicesByCategory: jest.fn().mockResolvedValue([acService]),
            findServiceById: jest.fn().mockResolvedValue(acService),
            findActiveServicesByIds: jest.fn().mockResolvedValue([acService, plmService]),
            findServiceByCode: jest.fn().mockResolvedValue(null),
            createService: jest.fn(),
            updateService: jest.fn(),
            listActiveOffers: jest.fn().mockResolvedValue([]),
            findActivePromo: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: RepairBookingsRepository,
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

    service = moduleRef.get(ElkRepService);
    catalog = moduleRef.get(RepairCatalogRepository);
    bookings = moduleRef.get(RepairBookingsRepository);
    locations = moduleRef.get(LocationsRepository);
  });

  const cart = {
    items: [
      { serviceId: 'svc-ac', quantity: 1 },
      { serviceId: 'svc-plm', quantity: 2 },
    ],
  };

  describe('quote', () => {
    it('prices the cart server-side: lines + visit fee, no promo', async () => {
      const quote = await service.quote(cart);
      const breakdown = quote.breakdown as Record<string, number | null>;
      // 1×89 + 2×69 = 227, +15 visit fee
      expect(breakdown.subtotal).toBe(227);
      expect(breakdown.visitFee).toBe(15);
      expect(breakdown.discountAmount).toBe(0);
      expect(breakdown.totalAmount).toBe(242);
    });

    it('applies a percentage promo to the service subtotal only', async () => {
      catalog.findActivePromo.mockResolvedValue({
        id: 'p-1',
        code: 'AC60',
        kind: RepairPromoKind.PERCENT,
        value: 60,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const quote = await service.quote({ ...cart, promoCode: 'ac60' });
      const breakdown = quote.breakdown as Record<string, number | null>;
      // round(227×60%) = 136 off; fee not discounted
      expect(breakdown.discountAmount).toBe(136);
      expect(breakdown.totalAmount).toBe(227 - 136 + 15);
      expect(catalog.findActivePromo).toHaveBeenCalledWith('AC60');
    });

    it('caps a fixed promo at the subtotal', async () => {
      catalog.findActiveServicesByIds.mockResolvedValue([acService]);
      catalog.findActivePromo.mockResolvedValue({
        id: 'p-2',
        code: 'PAINT120',
        kind: RepairPromoKind.FIXED,
        value: 120,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const quote = await service.quote({
        items: [{ serviceId: 'svc-ac', quantity: 1 }],
        promoCode: 'PAINT120',
      });
      const breakdown = quote.breakdown as Record<string, number | null>;
      expect(breakdown.discountAmount).toBe(89); // capped, never negative
      expect(breakdown.totalAmount).toBe(15);
    });

    it('rejects unknown or inactive services', async () => {
      catalog.findActiveServicesByIds.mockResolvedValue([acService]);
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

    it('creates a paid CONFIRMED booking with snapshots and an ELK code', async () => {
      const booking = await service.createBooking(user, dto);
      expect(booking.code).toMatch(/^ELK-\d{4}$/);
      expect(booking.status).toBe('confirmed');
      expect(booking.address).toEqual({
        label: 'Home',
        line: 'Tower 3, Apt 1204, Al Reem Island',
      });
      const breakdown = booking.breakdown as Record<string, number | null>;
      expect(breakdown.totalAmount).toBe(242);
      expect(booking.paidAt).not.toBeNull();

      const created = bookings.create.mock.calls[0]![0];
      expect(created.booking.status).toBe(RepairBookingStatus.CONFIRMED);
      expect(created.items).toHaveLength(2);
      expect(created.items[0]).toMatchObject({ unitPrice: 89, quantity: 1, lineTotal: 89 });
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
      bookings.findForUser.mockResolvedValue({ id: 'b-1', code: 'ELK-1234' } as never);
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
      bookings.findById.mockResolvedValue({ id: 'b-1', code: 'ELK-1234' } as never);
      bookings.markCompleted.mockResolvedValue(false);
      await expect(service.completeBooking('b-1')).rejects.toBeInstanceOf(DomainException);
    });
  });

  describe('browse', () => {
    it('serves the home feed with live category counts', async () => {
      const feed = await service.getHomeFeed(user);
      expect(feed.userName).toBe('Demo');
      const categories = feed.categories as Record<string, unknown>[];
      expect(categories[0]).toMatchObject({ id: 'ac', label: 'AC & Cooling', serviceCount: 4 });
    });

    it('404s an inactive service detail', async () => {
      catalog.findServiceById.mockResolvedValue({ ...acService, isActive: false });
      await expect(service.getService('svc-ac')).rejects.toBeInstanceOf(ResourceNotFoundException);
    });
  });
});
