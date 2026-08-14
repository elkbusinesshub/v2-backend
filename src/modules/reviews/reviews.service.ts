import { HttpStatus, Injectable } from '@nestjs/common';
import { AdOrderStatus } from '@prisma/client';
import { DomainException, ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import { initialsOf } from '@/common/utils/initials';
import type { AuthUser } from '@/common/types/auth.types';
import { UsersRepository } from '@/modules/users/users.repository';
import { REVIEW_QUICK_TAGS, REVIEW_REWARD_POINTS } from './reviews.constants';
import type { SubmitReviewDto } from './reviews.dto';
import { ReviewsRepository } from './reviews.repository';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly reviews: ReviewsRepository,
    private readonly users: UsersRepository,
  ) {}

  /** The rating screen's payload — who and what is being rated, plus the tags. */
  async getReviewTarget(user: AuthUser, id: string): Promise<Record<string, unknown>> {
    const order = await this.assertReviewable(user, id);
    return {
      providerName: order.seller.name ?? 'ELK Seller',
      providerInitials: initialsOf(order.seller.name ?? 'ELK Seller'),
      serviceName: order.serviceName,
      // A listing carries no duration of its own on the order.
      durationLabel: '',
      quickTags: [...REVIEW_QUICK_TAGS],
      rewardPoints: REVIEW_REWARD_POINTS,
    };
  }

  async submitReview(
    user: AuthUser,
    id: string,
    dto: SubmitReviewDto,
  ): Promise<Record<string, unknown>> {
    const order = await this.assertReviewable(user, id);

    await this.reviews.create({
      adOrderId: order.id,
      userId: user.id,
      rating: dto.rating,
      tags: dto.tags,
      comment: dto.comment,
    });

    // Rolled onto the listing rather than the seller: a rating buyers see next
    // to a listing has to be about that listing's work.
    const { average, count } = await this.reviews.aggregateForAd(order.adId);
    await this.reviews.updateAdRating(order.adId, average, count);
    await this.users.incrementRewardPoints(user.id, REVIEW_REWARD_POINTS);

    return { rewardPoints: REVIEW_REWARD_POINTS };
  }

  /**
   * Owned by this buyer, completed, and not already rated.
   *
   * Scoped to the buyer: the person who paid is the one who gets to rate it.
   */
  private async assertReviewable(user: AuthUser, id: string) {
    const order = await this.reviews.findAdOrderForBuyer(id, user.id);
    if (!order) {
      throw new ResourceNotFoundException('Order');
    }
    if (order.status !== AdOrderStatus.COMPLETED) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'ORDER_NOT_COMPLETED',
        'Only completed orders can be reviewed',
      );
    }
    if (await this.reviews.findByAdOrderId(order.id)) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'ALREADY_REVIEWED',
        'This order has already been reviewed',
      );
    }
    return order;
  }
}
