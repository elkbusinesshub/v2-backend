import { HttpStatus, Injectable } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
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

  /** The rating screen's payload — provider/service context plus the tag vocabulary. */
  async getReviewTarget(user: AuthUser, bookingId: string): Promise<Record<string, unknown>> {
    const { service } = await this.assertReviewable(user, bookingId);
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
    bookingId: string,
    dto: SubmitReviewDto,
  ): Promise<Record<string, unknown>> {
    const { booking, service } = await this.assertReviewable(user, bookingId);

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
