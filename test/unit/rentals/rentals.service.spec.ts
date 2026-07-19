import { Test } from '@nestjs/testing';
import { Prisma, RentalBookingStatus, RentalCarCategory, Role } from '@prisma/client';
import { DomainException, ValidationFailedException } from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { RentalBookingsRepository } from '@/modules/rentals/rental-bookings.repository';
import { RentalCarsRepository } from '@/modules/rentals/rental-cars.repository';
import { RentalsService } from '@/modules/rentals/rentals.service';

const user: AuthUser = { id: 'u-1', roles: [Role.USER], jti: 'j', exp: 9999999999 };
const provider: AuthUser = { id: 'p-1', roles: [Role.PROVIDER], jti: 'j', exp: 9999999999 };

const car = {
  id: 'car-1',
  slug: 'toyota-camry',
  providerId: 'p-1',
  name: 'Toyota Camry',
  category: RentalCarCategory.SEDAN,
  iconKey: 'rental_sedan',
  seats: 5,
  transmission: 'Automatic',
  fuel: 'Petrol',
  rating: new Prisma.Decimal(4.8),
  pricePerDay: 199,
  badge: 'BEST DEAL',
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

const branch = {
  id: 'branch-1',
  slug: 'corniche',
  name: 'Abu Dhabi Corniche Branch',
  address: 'Corniche Road, Abu Dhabi',
  distanceLabel: '1.2 km',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const extraDefs = [
  {
    id: 'x-1',
    key: 'protection',
    name: 'Full Protection Plan',
    description: 'd',
    pricePerDay: 30,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'x-2',
    key: 'wifi',
    name: 'Portable Wi-Fi',
    description: 'd',
    pricePerDay: 10,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

/** pickup tomorrow 10:00 UTC, return +N days (+extraMinutes) later */
function range(daysLater: number, extraMinutes = 0): { pickupAt: string; returnAt: string } {
  const pickup = new Date();
  pickup.setUTCDate(pickup.getUTCDate() + 1);
  pickup.setUTCHours(10, 0, 0, 0);
  const ret = new Date(pickup.getTime() + daysLater * 86_400_000 + extraMinutes * 60_000);
  return { pickupAt: pickup.toISOString(), returnAt: ret.toISOString() };
}

describe('RentalsService', () => {
  let service: RentalsService;
  let cars: jest.Mocked<RentalCarsRepository>;
  let bookings: jest.Mocked<RentalBookingsRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RentalsService,
        {
          provide: RentalCarsRepository,
          useValue: {
            list: jest.fn(),
            findById: jest.fn().mockResolvedValue(car),
            findBySlug: jest.fn().mockResolvedValue(null),
            create: jest.fn(),
            update: jest.fn(),
            softDelete: jest.fn(),
            listBranches: jest.fn(),
            findBranchById: jest.fn().mockResolvedValue(branch),
            listActiveExtras: jest.fn(),
            findActiveExtrasByKeys: jest.fn().mockResolvedValue([]),
            findActivePromo: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: RentalBookingsRepository,
          useValue: {
            listForUser: jest.fn(),
            findForUser: jest.fn(),
            findById: jest.fn(),
            hasOverlap: jest.fn().mockResolvedValue(false),
            createIfAvailable: jest.fn().mockImplementation(({ booking, extras }) =>
              Promise.resolve({
                ...booking,
                id: 'b-1',
                createdAt: new Date(),
                updatedAt: new Date(),
                actualPickupAt: null,
                actualReturnAt: null,
                refundedAt: null,
                lateFee: 0,
                car,
                branch,
                extras,
              }),
            ),
            markPickedUp: jest.fn(),
            markReturned: jest.fn(),
            cancel: jest.fn(),
            codeExists: jest.fn().mockResolvedValue(false),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(RentalsService);
    cars = moduleRef.get(RentalCarsRepository);
    bookings = moduleRef.get(RentalBookingsRepository);
  });

  describe('quote — the checkout formula', () => {
    it('prices a weekly delivery rental with extras and ELK10 exactly like the app', async () => {
      cars.findActiveExtrasByKeys.mockResolvedValue(extraDefs);
      cars.findActivePromo.mockResolvedValue({
        id: 'promo-1',
        code: 'ELK10',
        percent: 10,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const quote = await service.quote({
        carId: car.id,
        rentalType: 'weekly',
        ...range(3),
        fulfilment: 'delivery',
        deliveryAddress: 'Al Reem Island, Abu Dhabi',
        extras: ['protection', 'wifi'],
        promoCode: 'elk10',
      });

      // dailyRate = round(199 × 0.85) = 169; 3 days → 507
      // extras (30+10)×3 = 120; delivery 25 → subtotal 652
      // promo 10% → 65; VAT 5% of 587 → 29; total 616
      expect(quote.breakdown).toEqual({
        days: 3,
        dailyRate: 169,
        rentalTotal: 507,
        deliveryFee: 25,
        extrasTotal: 120,
        subtotal: 652,
        promoCode: 'ELK10',
        promoDiscount: 65,
        vatAmount: 29,
        totalAmount: 616,
      });
    });

    it('rounds partial days up (3 days + 1 minute = 4 days)', async () => {
      const quote = await service.quote({
        carId: car.id,
        rentalType: 'daily',
        ...range(3, 1),
        fulfilment: 'pickup',
        branchId: branch.id,
      });
      expect((quote.breakdown as { days: number }).days).toBe(4);
      expect((quote.breakdown as { rentalTotal: number }).rentalTotal).toBe(199 * 4);
    });

    it('rejects return before pickup', async () => {
      const { pickupAt } = range(3);
      await expect(
        service.quote({
          carId: car.id,
          rentalType: 'daily',
          pickupAt,
          returnAt: pickupAt,
          fulfilment: 'pickup',
          branchId: branch.id,
        }),
      ).rejects.toBeInstanceOf(ValidationFailedException);
    });

    it('rejects pickup in the past', async () => {
      await expect(
        service.quote({
          carId: car.id,
          rentalType: 'daily',
          pickupAt: '2020-01-01T10:00:00Z',
          returnAt: '2020-01-03T10:00:00Z',
          fulfilment: 'pickup',
          branchId: branch.id,
        }),
      ).rejects.toBeInstanceOf(ValidationFailedException);
    });

    it('rejects unknown extras and invalid promo codes', async () => {
      cars.findActiveExtrasByKeys.mockResolvedValue([extraDefs[0]!]);
      await expect(
        service.quote({
          carId: car.id,
          rentalType: 'daily',
          ...range(2),
          fulfilment: 'pickup',
          branchId: branch.id,
          extras: ['protection', 'jetpack'],
        }),
      ).rejects.toBeInstanceOf(ValidationFailedException);

      cars.findActiveExtrasByKeys.mockResolvedValue([]);
      await expect(
        service.quote({
          carId: car.id,
          rentalType: 'daily',
          ...range(2),
          fulfilment: 'pickup',
          branchId: branch.id,
          promoCode: 'NOPE',
        }),
      ).rejects.toBeInstanceOf(ValidationFailedException);
    });
  });

  describe('createBooking', () => {
    const dto = {
      carId: car.id,
      rentalType: 'daily',
      ...range(3),
      fulfilment: 'pickup' as const,
      branchId: branch.id,
      paymentMethod: 'card',
      agreedToTerms: true as const,
    };

    it('creates a confirmed booking with an ELK-##### code and mock payment', async () => {
      const result = await service.createBooking(user, dto);
      expect(result.code).toMatch(/^ELK-\d{5}$/);
      expect(result.status).toBe('confirmed');

      const created = bookings.createIfAvailable.mock.calls[0]![0];
      expect(created.booking.status).toBe(RentalBookingStatus.CONFIRMED);
      expect(created.booking.paidAt).toBeInstanceOf(Date);
      expect(created.booking.paymentRef).toBe(`PAY-${created.booking.code}`);
    });

    it('maps an availability conflict to 409 CAR_UNAVAILABLE', async () => {
      bookings.createIfAvailable.mockResolvedValue(null);
      await expect(service.createBooking(user, dto)).rejects.toMatchObject({
        code: 'CAR_UNAVAILABLE',
      });
    });
  });

  describe('fulfilment transitions', () => {
    const activeBooking = {
      id: 'b-1',
      code: 'ELK-12345',
      userId: user.id,
      carId: car.id,
      rentalType: 'DAILY',
      fulfilment: 'PICKUP',
      branchId: branch.id,
      deliveryAddress: null,
      deliveryBuilding: null,
      deliveryNotes: null,
      pickupAt: new Date(Date.now() - 5 * 86_400_000),
      returnAt: new Date(Date.now() - 2.5 * 86_400_000), // due 2.5 days ago
      actualPickupAt: new Date(Date.now() - 5 * 86_400_000),
      actualReturnAt: null,
      days: 3,
      dailyRate: 169,
      rentalTotal: 507,
      deliveryFee: 0,
      extrasTotal: 0,
      subtotal: 507,
      promoCode: null,
      promoDiscount: 0,
      vatAmount: 25,
      totalAmount: 616,
      lateFee: 0,
      paymentMethod: 'card',
      paymentRef: 'PAY-ELK-12345',
      paidAt: new Date(),
      refundedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      car,
      branch,
      extras: [],
      status: RentalBookingStatus.ACTIVE,
    };

    it('charges ceil(overdue days) × dailyRate as late fee on return', async () => {
      bookings.findById.mockResolvedValue(activeBooking as never);
      bookings.markReturned.mockResolvedValue(true);

      await service.confirmReturn(provider, 'b-1');

      const [, , lateFee, newTotal] = bookings.markReturned.mock.calls[0]!;
      expect(lateFee).toBe(3 * 169); // 2.5 days overdue → 3 started days
      expect(newTotal).toBe(616 + 507);
    });

    it('rejects pickup confirmation from a non-owning provider', async () => {
      bookings.findById.mockResolvedValue({
        ...activeBooking,
        car: { ...car, providerId: 'someone-else' },
      } as never);
      await expect(service.confirmPickup({ ...provider, id: 'p-2' }, 'b-1')).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    });

    it('rejects double pickup (invalid transition)', async () => {
      bookings.findById.mockResolvedValue(activeBooking as never);
      bookings.markPickedUp.mockResolvedValue(false);
      await expect(service.confirmPickup(provider, 'b-1')).rejects.toBeInstanceOf(DomainException);
    });
  });
});
