import { Test } from '@nestjs/testing';
import { Prisma, Role } from '@prisma/client';
import {
  DomainException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { LocationsRepository } from '@/modules/locations/locations.repository';
import { PorterBookingsRepository } from '@/modules/porter/porter-bookings.repository';
import { PorterCatalogRepository } from '@/modules/porter/porter-catalog.repository';
import { PorterService } from '@/modules/porter/porter.service';

const user: AuthUser = { id: 'u-1', roles: [Role.USER], jti: 'j', exp: 9999999999 };

const bike = {
  id: 'veh-bike',
  slug: 'bike',
  name: 'Bike',
  emoji: '🏍️',
  iconKey: 'veh_bike',
  capacityLabel: 'Up to 5 kg',
  etaMinutes: 12,
  baseFare: new Prisma.Decimal(35),
  badge: 'FASTEST',
  isActive: true,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const addonDefs = [
  {
    id: 'a-helper',
    key: 'helper',
    label: 'Loading helper',
    price: new Prisma.Decimal(30),
    isActive: true,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'a-insure',
    key: 'insure',
    label: 'Insurance',
    price: new Prisma.Decimal(10),
    isActive: true,
    sortOrder: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

/** Tomorrow in the operating region (+04:00) as YYYY-MM-DD. */
function tomorrow(): string {
  return new Date(Date.now() + 4 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
}

const savedAddress = {
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

describe('PorterService', () => {
  let service: PorterService;
  let catalog: jest.Mocked<PorterCatalogRepository>;
  let bookings: jest.Mocked<PorterBookingsRepository>;
  let locations: jest.Mocked<LocationsRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PorterService,
        {
          provide: PorterCatalogRepository,
          useValue: {
            listActiveVehicles: jest.fn().mockResolvedValue([bike]),
            findActiveVehicleBySlug: jest.fn().mockResolvedValue(bike),
            listActiveAddons: jest.fn().mockResolvedValue(addonDefs),
            findActiveAddonsByKeys: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: PorterBookingsRepository,
          useValue: {
            create: jest.fn().mockImplementation(({ booking, addons }) =>
              Promise.resolve({
                ...booking,
                id: 'b-1',
                vehicle: bike,
                addons,
                pickedUpAt: null,
                deliveredAt: null,
                cancelledAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
              }),
            ),
            listForUser: jest.fn().mockResolvedValue([]),
            findForUser: jest.fn(),
            findById: jest.fn(),
            cancel: jest.fn(),
            markPickedUp: jest.fn(),
            markDelivered: jest.fn(),
            codeExists: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: LocationsRepository,
          useValue: { findByIdForUser: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = moduleRef.get(PorterService);
    catalog = moduleRef.get(PorterCatalogRepository);
    bookings = moduleRef.get(PorterBookingsRepository);
    locations = moduleRef.get(LocationsRepository);
  });

  describe('quote', () => {
    it('applies the booking flow formula: base + fee + 5% VAT', async () => {
      const quote = await service.quote({ vehicleId: 'bike' });
      // 35 + 3.5 = 38.5; VAT = 1.93 (rounded from 1.925); total 40.43
      expect(quote.breakdown).toMatchObject({
        baseFare: 35,
        addonsTotal: 0,
        serviceFee: 3.5,
        vatAmount: 1.93,
        totalAmount: 40.43,
      });
    });

    it('adds flat-priced add-ons before VAT', async () => {
      catalog.findActiveAddonsByKeys.mockResolvedValue(addonDefs);
      const quote = await service.quote({ vehicleId: 'bike', addons: ['helper', 'insure'] });
      // 35 + 40 + 3.5 = 78.5; VAT = 3.93 (rounded from 3.925); total 82.43
      expect(quote.breakdown).toMatchObject({
        addonsTotal: 40,
        vatAmount: 3.93,
        totalAmount: 82.43,
      });
    });

    it('rejects an unknown vehicle', async () => {
      catalog.findActiveVehicleBySlug.mockResolvedValue(null);
      await expect(service.quote({ vehicleId: 'jet' })).rejects.toBeInstanceOf(
        ValidationFailedException,
      );
    });

    it('rejects unknown add-on keys', async () => {
      catalog.findActiveAddonsByKeys.mockResolvedValue([addonDefs[0]!]);
      await expect(
        service.quote({ vehicleId: 'bike', addons: ['helper', 'rocket'] }),
      ).rejects.toBeInstanceOf(ValidationFailedException);
    });
  });

  describe('createBooking', () => {
    const base = {
      vehicleId: 'bike',
      pickupAddress: 'Dubai Marina, Block C',
      dropAddress: 'Downtown Dubai, Tower 4',
      paymentMethod: 'wallet',
    };

    it('books an ASAP pickup with a tracking code and mock payment', async () => {
      const booking = await service.createBooking(user, base);
      expect(booking.code).toMatch(/^ELK-\d{4}-[A-Z]{2}$/);
      expect(booking.status).toBe('confirmed');
      expect(booking.scheduledAt).toBeNull();
      const breakdown = booking.breakdown as Record<string, number>;
      expect(breakdown.totalAmount).toBe(40.43);
      expect(booking.paidAt).not.toBeNull();
    });

    it('books a scheduled pickup inside the 30-day horizon', async () => {
      const booking = await service.createBooking(user, {
        ...base,
        scheduledDate: tomorrow(),
        pickupWindow: '2:00 – 3:00 pm',
      });
      expect(booking.pickupWindow).toBe('2:00 – 3:00 pm');
      expect(booking.scheduledAt).not.toBeNull();
    });

    it('rejects a date beyond the horizon', async () => {
      const far = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
      await expect(
        service.createBooking(user, {
          ...base,
          scheduledDate: far,
          pickupWindow: '9:00 – 10:00',
        }),
      ).rejects.toBeInstanceOf(ValidationFailedException);
    });

    it('rejects a schedule date without a window', async () => {
      await expect(
        service.createBooking(user, { ...base, scheduledDate: tomorrow() }),
      ).rejects.toBeInstanceOf(ValidationFailedException);
    });

    it('resolves a saved address id to its formatted text, overriding free text', async () => {
      locations.findByIdForUser.mockResolvedValue(savedAddress);
      const booking = await service.createBooking(user, {
        vehicleId: 'bike',
        pickupAddressId: 'addr-1',
        dropAddress: 'Downtown Dubai, Tower 4',
        paymentMethod: 'wallet',
      });
      expect(booking.pickupAddress).toBe('Tower 3, Apt 1204, Al Reem Island');
      expect(locations.findByIdForUser).toHaveBeenCalledWith('addr-1', user.id);
    });

    it("404s when the saved address isn't the caller's", async () => {
      locations.findByIdForUser.mockResolvedValue(null);
      await expect(
        service.createBooking(user, {
          vehicleId: 'bike',
          pickupAddressId: 'addr-x',
          dropAddress: 'Downtown Dubai, Tower 4',
          paymentMethod: 'wallet',
        }),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });
  });

  describe('lifecycle', () => {
    it('409s a cancellation after pickup', async () => {
      bookings.findForUser.mockResolvedValue({ id: 'b-1', code: 'ELK-1234-AB' } as never);
      bookings.cancel.mockResolvedValue(false);
      await expect(service.cancelBooking(user, 'b-1')).rejects.toMatchObject({
        code: 'NOT_CANCELLABLE',
      });
    });

    it('404s a foreign booking', async () => {
      bookings.findForUser.mockResolvedValue(null);
      await expect(service.getBooking(user, 'b-x')).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });

    it('409s delivery confirmation before pickup', async () => {
      bookings.findById.mockResolvedValue({ id: 'b-1', code: 'ELK-1234-AB' } as never);
      bookings.markDelivered.mockResolvedValue(false);
      await expect(service.confirmDelivery('b-1')).rejects.toBeInstanceOf(DomainException);
    });
  });

  describe('options', () => {
    it('serves vehicles, add-ons, windows and the legacy route card', async () => {
      const options = await service.getOptions();
      const vehicles = options.vehicles as Record<string, unknown>[];
      expect(vehicles[0]).toMatchObject({ id: 'bike', emoji: '🏍️', baseFare: 35 });
      expect(options.pickupWindows).toHaveLength(4);
      const route = options.route as Record<string, unknown>;
      expect(route.estimatedFare).toBe(35);
      expect(route.distanceKm).toBe(4.2);
    });
  });
});
