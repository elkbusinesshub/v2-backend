import { Inject, Injectable } from '@nestjs/common';
import { RideBookingStatus, type Prisma, type RideBooking, type RideType } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

const WITH_TYPE = { rideType: true } as const;
export type RideBookingWithType = RideBooking & { rideType: RideType };

@Injectable()
export class RideBookingsRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async create(
    data: Omit<Prisma.RideBookingUncheckedCreateInput, 'id'>,
  ): Promise<RideBookingWithType> {
    return this.db.rideBooking.create({ data, include: WITH_TYPE });
  }

  async listForUser(userId: string): Promise<RideBookingWithType[]> {
    return this.db.rideBooking.findMany({
      where: { userId },
      include: WITH_TYPE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findForUser(id: string, userId: string): Promise<RideBookingWithType | null> {
    return this.db.rideBooking.findFirst({ where: { id, userId }, include: WITH_TYPE });
  }

  /**
   * Atomic status transitions — each succeeds only from the expected
   * previous status, so a double-tap or a race can never double-apply.
   */
  async start(id: string, userId: string): Promise<boolean> {
    const result = await this.db.rideBooking.updateMany({
      where: { id, userId, status: RideBookingStatus.CONFIRMED },
      data: { status: RideBookingStatus.IN_PROGRESS, startedAt: new Date() },
    });
    return result.count === 1;
  }

  async complete(id: string, userId: string): Promise<boolean> {
    const result = await this.db.rideBooking.updateMany({
      where: { id, userId, status: RideBookingStatus.IN_PROGRESS },
      data: { status: RideBookingStatus.COMPLETED, completedAt: new Date() },
    });
    return result.count === 1;
  }

  async cancel(id: string, userId: string): Promise<boolean> {
    const result = await this.db.rideBooking.updateMany({
      where: { id, userId, status: RideBookingStatus.CONFIRMED },
      data: { status: RideBookingStatus.CANCELLED, cancelledAt: new Date() },
    });
    return result.count === 1;
  }

  /** One-time rating — only once the trip is COMPLETED and not yet rated. */
  async rate(id: string, userId: string, stars: number, tip: number): Promise<boolean> {
    const result = await this.db.rideBooking.updateMany({
      where: {
        id,
        userId,
        status: RideBookingStatus.COMPLETED,
        ratingStars: null,
      },
      data: { ratingStars: stars, tipAmount: tip },
    });
    return result.count === 1;
  }

  async codeExists(code: string): Promise<boolean> {
    const row = await this.db.rideBooking.findUnique({ where: { code }, select: { id: true } });
    return row !== null;
  }
}
