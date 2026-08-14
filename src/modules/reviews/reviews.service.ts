import { HttpStatus, Injectable } from '@nestjs/common';
import { AdOrderStatus, BookingStatus } from '@prisma/client';
import { DomainException, ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import { initialsOf } from '@/common/utils/initials';
import type { AuthUser } from '@/common/types/auth.types';
import { BookingsRepository } from '@/modules/bookings/bookings.repository';
import { ServicesRepository } from '@/modules/services/services.repository';
import { UsersRepository } from '@/modules/users/users.repository';
import { REVIEW_QUICK_TAGS, REVIEW_REWARD_POINTS } from './reviews.constants';
import type { SubmitReviewDto } from './reviews.dto';
import { ReviewsRepository } from './reviews.repository';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly reviews: ReviewsRepository,
    private readonly bookings: BookingsRepository,
    private readonly services: ServicesRepository,
    private readonly users: UsersRepository,
  ) {}

  /** The rating screen's payload — who and what is being rated, plus the tags. */
  async getReviewTarget(user: AuthUser, id: string): Promise<Record<string, unknown>> {
    const order = await this.reviews.findAdOrderForBuyer(id, user.id);
    if (order) {
      await this.assertAdOrderReviewable(order);
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

    const { service } = await this.assertReviewable(user, id);
    return {
      providerName: service.providerName,
      providerInitials: initialsOf(service.providerName),
      serviceName: service.name,
      durationLabel: service.durationLabel,
      quickTags: [...REVIEW_QUICK_TAGS],
      rewardPoints: REVIEW_REWARD_POINTS,
    };
  }

  async submitReview(
    user: AuthUser,
    id: string,
    dto: SubmitReviewDto,
  ): Promise<Record<string, unknown>> {
    const order = await this.reviews.findAdOrderForBuyer(id, user.id);
    if (order) {
      await this.assertAdOrderReviewable(order);
      await this.reviews.create({
        adOrderId: order.id,
        userId: user.id,
        rating: dto.rating,
        tags: dto.tags,
        comment: dto.comment,
      });
      // No aggregate is updated: a listing has no rating column, so the
      // review is recorded without a score to roll it into. Adding one is a
      // separate piece of work from letting people leave the review at all.
      await this.users.incrementRewardPoints(user.id, REVIEW_REWARD_POINTS);
      return { rewardPoints: REVIEW_REWARD_POINTS };
    }

    const { booking, service } = await this.assertReviewable(user, id);

    await this.reviews.create({
      bookingId: booking.id,
      userId: user.id,
      rating: dto.rating,
      tags: dto.tags,
      comment: dto.comment,
    });

    const { average, count } = await this.reviews.aggregateForService(service.id);
    await this.services.updateRatingAggregate(service.id, average, count);
    await this.users.incrementRewardPoints(user.id, REVIEW_REWARD_POINTS);

    return { rewardPoints: REVIEW_REWARD_POINTS };
  }

  /** Completed + not-already-reviewed, for an order against a listing. */
  private async assertAdOrderReviewable(order: { id: string; status: AdOrderStatus }) {
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
  }

  /** Ownership + completed + not-already-reviewed, all in one guard. */
  private async assertReviewable(user: AuthUser, bookingId: string) {
    const booking = await this.bookings.findByIdForUser(bookingId, user.id);
    if (!booking) {
      throw new ResourceNotFoundException('Booking');
    }
    if (booking.status !== BookingStatus.COMPLETED) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'BOOKING_NOT_COMPLETED',
        'Only completed bookings can be reviewed',
      );
    }
    const existing = await this.reviews.findByBookingId(bookingId);
    if (existing) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'ALREADY_REVIEWED',
        'This booking has already been reviewed',
      );
    }
    const service = await this.services.findById(booking.serviceId);
    if (!service) {
      throw new ResourceNotFoundException('Service');
    }
    return { booking, service };
  }
}
