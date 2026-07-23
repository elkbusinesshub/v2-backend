import { Test } from '@nestjs/testing';
import { BookingStatus, Prisma } from '@prisma/client';
import {
  DomainException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import { BookingsRepository, BookingWithService } from '@/modules/bookings/bookings.repository';
import { BookingsService } from '@/modules/bookings/bookings.service';
import { TIME_SLOTS, upcomingDates } from '@/modules/services/booking-window';
import { ServicesRepository, ServiceWithCategory } from '@/modules/services/services.repository';

const category = {
  id: 'cat-1',
  slug: 'cleaning',
  name: 'Cleaning',
  icon: '🧹',
  colorHex: 0xfffef3c7,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const service: ServiceWithCategory = {
  id: 'svc-1',
  categoryId: category.id,
  slug: 'deep_cleaning',
  name: 'Deep Cleaning',
  icon: '✨',
  badge: null,
  description: 'desc',
  price: new Prisma.Decimal(149),
  priceUnit: '/ session',
  durationLabel: '3-4 hrs',
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
};

function makeBooking(overrides: Partial<BookingWithService> = {}): BookingWithService {
  return {
    id: 'bk-1',
    reference: 'ELK-2026-00001',
    userId: 'u-1',
    serviceId: service.id,
    status: BookingStatus.CONFIRMED,
    scheduledAt: new Date('2026-07-08T10:00:00Z'),
    addressText: 'Marina Bay',
    serviceFee: new Prisma.Decimal(149),
    total: new Prisma.Decimal(149),
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    service,
    ...overrides,
  };
}

/** A valid (day, time) pick inside the current booking window. */
const validDay = upcomingDates()[0]!.day;
const validTime = TIME_SLOTS[1]!;

describe('BookingsService', () => {
  let bookingsService: BookingsService;
  let bookings: jest.Mocked<BookingsRepository>;
  let services: jest.Mocked<ServicesRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        {
          provide: BookingsRepository,
          useValue: {
            create: jest.fn().mockImplementation((data) => makeBooking(data)),
            findAllByUser: jest.fn(),
            findByIdForUser: jest.fn(),
            cancel: jest.fn().mockResolvedValue(true),
            markCompleted: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: ServicesRepository,
          useValue: { findById: jest.fn().mockResolvedValue(service) },
        },
      ],
    }).compile();

    bookingsService = moduleRef.get(BookingsService);
    bookings = moduleRef.get(BookingsRepository);
    services = moduleRef.get(ServicesRepository);
  });

  describe('create', () => {
    it('books a valid slot at the server-side price, ignoring the client total', async () => {
      const confirmation = await bookingsService.create('u-1', {
        serviceId: service.id,
        day: validDay,
        time: validTime,
        address: 'Marina Bay',
        total: 1, // must be ignored
      });

      const created = bookings.create.mock.calls[0]![0];
      expect(created.userId).toBe('u-1');
      expect(created.total).toEqual(service.price);
      expect(created.reference).toMatch(/^ELK-\d{4}-\d{5}$/);
      expect(confirmation.amountPaid).toBe(149);
      expect(confirmation.serviceName).toBe('Deep Cleaning');
      expect(confirmation.dateTimeLabel).toContain(validTime);
    });

    it('rejects a day outside the booking window', async () => {
      const outsideDay = ((validDay + 15) % 28) + 1;

      await expect(
        bookingsService.create('u-1', {
          serviceId: service.id,
          day: outsideDay,
          time: validTime,
          address: 'Marina Bay',
        }),
      ).rejects.toBeInstanceOf(ValidationFailedException);
      expect(bookings.create).not.toHaveBeenCalled();
    });

    it('rejects a time that is not an offered slot', async () => {
      await expect(
        bookingsService.create('u-1', {
          serviceId: service.id,
          day: validDay,
          time: '09:37',
          address: 'Marina Bay',
        }),
      ).rejects.toBeInstanceOf(ValidationFailedException);
    });

    it('404s for an unknown service', async () => {
      services.findById.mockResolvedValue(null);

      await expect(
        bookingsService.create('u-1', {
          serviceId: 'ghost',
          day: validDay,
          time: validTime,
          address: 'Marina Bay',
        }),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });

    it('retries the reference on a unique-constraint collision', async () => {
      const collision = new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      });
      bookings.create
        .mockRejectedValueOnce(collision)
        .mockImplementation((data) =>
          Promise.resolve(makeBooking(data as Partial<BookingWithService>)),
        );

      const confirmation = await bookingsService.create('u-1', {
        serviceId: service.id,
        day: validDay,
        time: validTime,
        address: 'Marina Bay',
      });

      expect(bookings.create).toHaveBeenCalledTimes(2);
      expect(confirmation.bookingReference).toMatch(/^ELK-/);
    });
  });

  describe('list', () => {
    it('maps rows to list items with numeric totals', async () => {
      bookings.findAllByUser.mockResolvedValue([makeBooking()]);

      const items = await bookingsService.list('u-1');

      expect(items).toEqual([
        {
          id: 'bk-1',
          reference: 'ELK-2026-00001',
          serviceName: 'Deep Cleaning',
          serviceIcon: '✨',
          providerName: 'Royal Shine Cleaning Co.',
          status: BookingStatus.CONFIRMED,
          scheduledAt: '2026-07-08T10:00:00.000Z',
          addressText: 'Marina Bay',
          total: 149,
        },
      ]);
    });
  });

  describe('cancel', () => {
    it('cancels an owned confirmed booking', async () => {
      bookings.findByIdForUser.mockResolvedValue(makeBooking());

      await bookingsService.cancel('u-1', 'bk-1');

      expect(bookings.cancel).toHaveBeenCalledWith('bk-1');
    });

    it("404s for another user's booking", async () => {
      bookings.findByIdForUser.mockResolvedValue(null);

      await expect(bookingsService.cancel('u-2', 'bk-1')).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
      expect(bookings.cancel).not.toHaveBeenCalled();
    });

    it('409s when the booking is already cancelled or completed', async () => {
      bookings.findByIdForUser.mockResolvedValue(makeBooking({ status: BookingStatus.CANCELLED }));
      bookings.cancel.mockResolvedValue(false);

      await expect(bookingsService.cancel('u-1', 'bk-1')).rejects.toBeInstanceOf(DomainException);
    });
  });

  describe('complete', () => {
    it('marks a confirmed booking done', async () => {
      await bookingsService.complete('bk-1');
      expect(bookings.markCompleted).toHaveBeenCalledWith('bk-1');
    });

    it('409s unless the booking was confirmed', async () => {
      bookings.markCompleted.mockResolvedValue(false);
      await expect(bookingsService.complete('bk-1')).rejects.toBeInstanceOf(DomainException);
    });
  });
});
