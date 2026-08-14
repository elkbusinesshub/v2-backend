import { Test } from '@nestjs/testing';
import { AdOrderStatus, Role } from '@prisma/client';
import { DomainException, ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { UsersRepository } from '@/modules/users/users.repository';
import { ReviewsRepository } from '@/modules/reviews/reviews.repository';
import { ReviewsService } from '@/modules/reviews/reviews.service';

const user: AuthUser = { id: 'u-1', roles: [Role.USER], jti: 'j', exp: 9999999999 };

const completedOrder = {
  id: 'ao-1',
  adId: 'ad-1',
  status: AdOrderStatus.COMPLETED,
  serviceName: 'Deep Cleaning',
  seller: { name: 'Royal Shine Cleaning Co.' },
  ad: { title: 'Deep Cleaning' },
};

const existingReview = {
  id: 'r-1',
  adOrderId: 'ao-1',
  userId: 'u-1',
  rating: 5,
  tags: [],
  comment: '',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ReviewsService', () => {
  let reviewsService: ReviewsService;
  let reviews: jest.Mocked<ReviewsRepository>;
  let users: jest.Mocked<UsersRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewsService,
        {
          provide: ReviewsRepository,
          useValue: {
            findAdOrderForBuyer: jest.fn().mockResolvedValue(completedOrder),
            findByAdOrderId: jest.fn().mockResolvedValue(null),
            create: jest.fn(),
            aggregateForAd: jest.fn().mockResolvedValue({ average: 4.8, count: 3 }),
            updateAdRating: jest.fn(),
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
    users = moduleRef.get(UsersRepository);
  });

  describe('getReviewTarget', () => {
    it('returns seller/listing context with computed initials', async () => {
      const target = await reviewsService.getReviewTarget(user, 'ao-1');

      expect(target).toMatchObject({
        providerName: 'Royal Shine Cleaning Co.',
        providerInitials: 'RS',
        serviceName: 'Deep Cleaning',
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

    it('404s an order the caller did not place', async () => {
      // Scoped to the buyer, so a seller's own order reads as missing here.
      reviews.findAdOrderForBuyer.mockResolvedValue(null);
      await expect(reviewsService.getReviewTarget(user, 'ao-x')).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });

    it('409s an order that is not finished', async () => {
      reviews.findAdOrderForBuyer.mockResolvedValue({
        ...completedOrder,
        status: AdOrderStatus.IN_PROGRESS,
      } as never);
      await expect(reviewsService.getReviewTarget(user, 'ao-1')).rejects.toMatchObject({
        code: 'ORDER_NOT_COMPLETED',
      });
    });

    it('409s an order already reviewed', async () => {
      reviews.findByAdOrderId.mockResolvedValue(existingReview);
      await expect(reviewsService.getReviewTarget(user, 'ao-1')).rejects.toMatchObject({
        code: 'ALREADY_REVIEWED',
      });
    });
  });

  describe('submitReview', () => {
    const dto = { rating: 5, tags: ['On Time', 'Professional'], comment: 'Great job!' };

    it('creates a review and rolls it into the listing’s rating', async () => {
      const result = await reviewsService.submitReview(user, 'ao-1', dto);

      expect(reviews.create).toHaveBeenCalledWith({
        adOrderId: 'ao-1',
        userId: 'u-1',
        rating: 5,
        tags: dto.tags,
        comment: 'Great job!',
      });
      // Recomputed whole from the listing's reviews, not nudged — so the
      // stored average cannot drift away from the reviews behind it.
      expect(reviews.aggregateForAd).toHaveBeenCalledWith('ad-1');
      expect(reviews.updateAdRating).toHaveBeenCalledWith('ad-1', 4.8, 3);
      expect(users.incrementRewardPoints).toHaveBeenCalledWith('u-1', 15);
      expect(result).toEqual({ rewardPoints: 15 });
    });

    it('rejects a second review on the same order', async () => {
      reviews.findByAdOrderId.mockResolvedValue(existingReview);

      await expect(reviewsService.submitReview(user, 'ao-1', dto)).rejects.toBeInstanceOf(
        DomainException,
      );
      expect(reviews.create).not.toHaveBeenCalled();
      expect(reviews.updateAdRating).not.toHaveBeenCalled();
    });
  });
});
