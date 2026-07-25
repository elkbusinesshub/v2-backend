import { Test } from '@nestjs/testing';
import { Role, StayBookingStatus, StayBookingType, StayCategoryType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  DomainException,
  DuplicateResourceException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { CacheService } from '@/cache/cache.service';
import { ElkStayService } from '@/modules/elkstay/elkstay.service';
import { StayBookingsRepository } from '@/modules/elkstay/stay-bookings.repository';
import { StaysRepository } from '@/modules/elkstay/stays.repository';
import { UsersRepository } from '@/modules/users/users.repository';

const user: AuthUser = { id: 'u-1', roles: [Role.USER], jti: 'j', exp: 9999999999 };

const stay = {
  id: 'stay-1',
  slug: 'maple-nest',
  providerId: 'p-1',
  name: 'Maple Nest Residency',
  categoryType: StayCategoryType.PG_STAY,
  badge: "Women's PG",
  roomType: 'Single room',
  location: 'Koramangala',
  fullAddress: '5th Block, Koramangala · 1.2 km away',
  distanceKm: new Prisma.Decimal(1.2),
  latitude: null,
  longitude: null,
  pricePerMonth: 11500,
  rating: new Prisma.Decimal(4.8),
  isVerified: true,
  description: 'desc',
  gradientStart: 0xff1c5044n,
  gradientEnd: 0xff3a7261n,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

const roomOption = {
  id: 'room-1',
  stayId: 'stay-1',
  kind: 'Double Sharing',
  subtitle: '2 beds · shared bath',
  pricePerMonth: 11000,
  sortOrder: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const futureDate = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 30);
  return d.toISOString().slice(0, 10);
};

describe('ElkStayService', () => {
  let service: ElkStayService;
  let stays: jest.Mocked<StaysRepository>;
  let bookings: jest.Mocked<StayBookingsRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ElkStayService,
        {
          provide: StaysRepository,
          useValue: {
            findById: jest.fn().mockResolvedValue(stay),
            findBySlug: jest.fn().mockResolvedValue(null),
            findRoomOption: jest.fn().mockResolvedValue(roomOption),
            findActiveCoupon: jest.fn().mockResolvedValue(null),
            list: jest.fn(),
            topRated: jest.fn(),
            categoryCounts: jest.fn(),
            isFavorite: jest.fn(),
            addFavorite: jest.fn(),
            removeFavorite: jest.fn(),
            listFavorites: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            softDelete: jest.fn(),
            setVerified: jest.fn(),
          },
        },
        {
          provide: StayBookingsRepository,
          useValue: {
            listForUser: jest.fn(),
            findForUser: jest.fn(),
            create: jest.fn().mockImplementation(({ ...data }: Record<string, unknown>) =>
              Promise.resolve({
                ...data,
                id: 'b-1',
                createdAt: new Date(),
                updatedAt: new Date(),
                stay,
              }),
            ),
            hasActiveVisit: jest.fn().mockResolvedValue(false),
            cancel: jest.fn(),
            codeExists: jest.fn().mockResolvedValue(false),
          },
        },
        { provide: UsersRepository, useValue: { findById: jest.fn() } },
        { provide: CacheService, useValue: { wrap: jest.fn(), del: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(ElkStayService);
    stays = moduleRef.get(StaysRepository);
    bookings = moduleRef.get(StayBookingsRepository);
  });

  describe('createBooking', () => {
    const dto = {
      stayId: 'stay-1',
      roomOptionId: 'room-1',
      moveInDate: futureDate(),
      durationMonths: 6,
      paymentMethod: 'upi',
    };

    it('computes the checkout formula: rent + deposit + fee − discount', async () => {
      stays.findActiveCoupon.mockResolvedValue({
        id: 'c1',
        code: 'ELKNEW',
        discountAmount: 500,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.createBooking(user, { ...dto, couponCode: 'elknew' });

      // 11000 + 11000 + 499 − 500
      expect(result.breakdown).toEqual({
        firstMonthRent: 11000,
        securityDeposit: 11000,
        serviceFee: 499,
        discount: 500,
        total: 21999,
      });
      const created = bookings.create.mock.calls[0]![0];
      expect(created.status).toBe(StayBookingStatus.CONFIRMED);
      expect(created.type).toBe(StayBookingType.STAY);
      expect(created.code).toMatch(/^ELK-[A-Z0-9]{5}$/);
      expect(created.couponCode).toBe('ELKNEW'); // normalized to uppercase
      expect(created.paidAt).toBeInstanceOf(Date);
    });

    it('rejects a room option that belongs to another stay', async () => {
      stays.findRoomOption.mockResolvedValue({ ...roomOption, stayId: 'other-stay' });
      await expect(service.createBooking(user, dto)).rejects.toBeInstanceOf(
        ValidationFailedException,
      );
      expect(bookings.create).not.toHaveBeenCalled();
    });

    it('rejects a past move-in date', async () => {
      await expect(
        service.createBooking(user, { ...dto, moveInDate: '2020-01-01' }),
      ).rejects.toBeInstanceOf(ValidationFailedException);
    });

    it('rejects an unknown coupon', async () => {
      await expect(
        service.createBooking(user, { ...dto, couponCode: 'NOPE' }),
      ).rejects.toBeInstanceOf(ValidationFailedException);
    });

    it('sets next due date to the 1st of the month after move-in', async () => {
      await service.createBooking(user, { ...dto, moveInDate: '2027-06-12' });
      const created = bookings.create.mock.calls[0]![0];
      expect((created.nextDueDate as Date).toISOString().slice(0, 10)).toBe('2027-07-01');
    });
  });

  describe('scheduleVisit', () => {
    it('rejects a visit time in the past', async () => {
      await expect(
        service.scheduleVisit(user, { stayId: 'stay-1', visitAt: '2020-01-01T10:00:00Z' }),
      ).rejects.toBeInstanceOf(ValidationFailedException);
    });

    it('rejects a duplicate active visit for the same stay', async () => {
      bookings.hasActiveVisit.mockResolvedValue(true);
      await expect(
        service.scheduleVisit(user, {
          stayId: 'stay-1',
          visitAt: new Date(Date.now() + 86_400_000).toISOString(),
        }),
      ).rejects.toBeInstanceOf(DuplicateResourceException);
    });
  });

  describe('cancelBooking', () => {
    it('rejects cancelling a confirmed booking', async () => {
      bookings.findForUser.mockResolvedValue({
        id: 'b-1',
        status: StayBookingStatus.CONFIRMED,
      } as never);
      bookings.cancel.mockResolvedValue(false);
      await expect(service.cancelBooking(user, 'b-1')).rejects.toBeInstanceOf(DomainException);
    });
  });
});
