import { Test } from '@nestjs/testing';
import { BookingStatus, Prisma, Role } from '@prisma/client';
import { DomainException, ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { BookingsRepository } from '@/modules/bookings/bookings.repository';
import { ServicesRepository, ServiceWithCategory } from '@/modules/services/services.repository';
import { UsersRepository } from '@/modules/users/users.repository';
import { ReviewsRepository } from '@/modules/reviews/reviews.repository';
import { ReviewsService } from '@/modules/reviews/reviews.service';

const user: AuthUser = { id: 'u-1', roles: [Role.USER], jti: 'j', exp: 9999999999 };

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

const completedBooking = {
  id: 'b-1',
  reference: 'ELK-2026-00001',
  userId: 'u-1',
  serviceId: 'svc-1',
  status: BookingStatus.COMPLETED,
  scheduledAt: new Date(),
  addressText: 'Home',
  serviceFee: new Prisma.Decimal(149),
  total: new Prisma.Decimal(149),
  cancelledAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ReviewsService', () => {
  let reviewsService: ReviewsService;
  let reviews: jest.Mocked<ReviewsRepository>;
  let bookings: jest.Mocked<BookingsRepository>;
  let services: jest.Mocked<ServicesRepository>;
  let users: jest.Mocked<UsersRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewsService,
        {
          provide: ReviewsRepository,
          useValue: {
            findByBookingId: jest.fn().mockResolvedValue(null),
            create: jest.fn(),
            aggregateForService: jest.fn().mockResolvedValue({ average: 4.8, count: 3 }),
          },
        },
        {
          provide: BookingsRepository,
          useValue: { findByIdForUser: jest.fn().mockResolvedValue(completedBooking) },
        },
        {
          provide: ServicesRepository,
          useValue: {
            findById: jest.fn().mockResolvedValue(service),
            updateRatingAggregate: jest.fn(),
          },
        },
        {
          provide: UsersRepository,
          useValue: { incrementRewardPoints: jest.fn() },
        },
      ],
    }).compile();

    reviewsService = moduleRef.get(ReviewsService);
    reviews = moduleRef.get(ReviewsRepository);
    bookings = moduleRef.get(BookingsRepository);
    services = moduleRef.get(ServicesRepository);
    users = moduleRef.get(UsersRepository);
  });

  describe('getReviewTarget', () => {
    it('returns provider/service context with computed initials', async () => {
      const target = await reviewsService.getReviewTarget(user, 'b-1');
      expect(target).toMatchObject({
        providerName: 'Royal Shine Cleaning Co.',
        providerInitials: 'RS',
        serviceName: 'Deep Cleaning',
        durationLabel: '3-4 hrs',
        rewardPoints: 15,
      });
      expect(target.quickTags).toEqual([
        'On Time',
        'Professional',
        'Thorough Job',
        'Friendly',
        'Great Value',
      ]);
    });

    it('404s a foreign booking', async () => {
      bookings.findByIdForUser.mockResolvedValue(null);
      await expect(reviewsService.getReviewTarget(user, 'b-x')).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });

    it('409s an incomplete booking', async () => {
      bookings.findByIdForUser.mockResolvedValue({
        ...completedBooking,
        status: BookingStatus.CONFIRMED,
      });
      await expect(reviewsService.getReviewTarget(user, 'b-1')).rejects.toMatchObject({
        code: 'BOOKING_NOT_COMPLETED',
      });
    });

    it('409s a booking already reviewed', async () => {
      reviews.findByBookingId.mockResolvedValue({
        id: 'r-1',
        bookingId: 'b-1',
        userId: 'u-1',
        rating: 5,
        tags: [],
        comment: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await expect(reviewsService.getReviewTarget(user, 'b-1')).rejects.toMatchObject({
        code: 'ALREADY_REVIEWED',
      });
    });
  });

  describe('submitReview', () => {
    const dto = { rating: 5, tags: ['On Time', 'Professional'], comment: 'Great job!' };

    it('creates a review and recomputes the service rating aggregate', async () => {
      const result = await reviewsService.submitReview(user, 'b-1', dto);
      expect(reviews.create).toHaveBeenCalledWith({
        bookingId: 'b-1',
        userId: 'u-1',
        rating: 5,
        tags: dto.tags,
        comment: 'Great job!',
      });
      expect(services.updateRatingAggregate).toHaveBeenCalledWith('svc-1', 4.8, 3);
      expect(users.incrementRewardPoints).toHaveBeenCalledWith('u-1', 15);
      expect(result).toEqual({ rewardPoints: 15 });
    });

    it('rejects a second review on the same booking', async () => {
      reviews.findByBookingId.mockResolvedValue({
        id: 'r-1',
        bookingId: 'b-1',
        userId: 'u-1',
        rating: 5,
        tags: [],
        comment: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await expect(reviewsService.submitReview(user, 'b-1', dto)).rejects.toBeInstanceOf(
        DomainException,
      );
      expect(reviews.create).not.toHaveBeenCalled();
    });
  });
});
