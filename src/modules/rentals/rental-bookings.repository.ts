import { Inject, Injectable } from '@nestjs/common';
import { Prisma, RentalBookingStatus } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';
import type { RentalBookingFull } from './rentals.mapper';

const BLOCKING_STATUSES: RentalBookingStatus[] = [
  RentalBookingStatus.CONFIRMED,
  RentalBookingStatus.ACTIVE,
];

const FULL_INCLUDE = { car: true, branch: true, extras: true } as const;

export interface CreateBookingData {
  booking: Omit<Prisma.RentalBookingUncheckedCreateInput, 'id'>;
  extras: { extraId: string; name: string; pricePerDay: number }[];
}

@Injectable()
export class RentalBookingsRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async listForUser(userId: string): Promise<RentalBookingFull[]> {
    return this.db.rentalBooking.findMany({
      where: { userId },
      include: FULL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findForUser(id: string, userId: string): Promise<RentalBookingFull | null> {
    return this.db.rentalBooking.findFirst({ where: { id, userId }, include: FULL_INCLUDE });
  }

  async findById(id: string): Promise<RentalBookingFull | null> {
    return this.db.rentalBooking.findFirst({ where: { id }, include: FULL_INCLUDE });
  }

  /** Overlap check outside a booking attempt (availability endpoint). */
  async hasOverlap(carId: string, from: Date, to: Date): Promise<boolean> {
    const count = await this.db.rentalBooking.count({
      where: {
        carId,
        status: { in: BLOCKING_STATUSES },
        pickupAt: { lt: to },
        returnAt: { gt: from },
      },
    });
    return count > 0;
  }

  /**
   * Availability-safe creation. Inside one transaction:
   *   1. row-lock the car (SELECT … FOR UPDATE) — concurrent attempts for
   *      the same car serialize here
   *   2. re-check for overlapping CONFIRMED/ACTIVE bookings
   *   3. insert the booking + extras snapshot
   * Returns null when the period is already taken (service maps to 409).
   */
  async createIfAvailable(data: CreateBookingData): Promise<RentalBookingFull | null> {
    const { booking, extras } = data;
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM rental_cars WHERE id = ${booking.carId} FOR UPDATE`;

      const overlapping = await tx.rentalBooking.count({
        where: {
          carId: booking.carId,
          status: { in: BLOCKING_STATUSES },
          pickupAt: { lt: booking.returnAt as Date },
          returnAt: { gt: booking.pickupAt as Date },
        },
      });
      if (overlapping > 0) {
        return null;
      }

      return tx.rentalBooking.create({
        data: { ...booking, extras: { create: extras } },
        include: FULL_INCLUDE,
      });
    });
  }

  /**
   * Atomic status transitions — each succeeds only from the expected
   * previous status, so a double-tap or a race can never double-apply.
   */
  async markPickedUp(id: string): Promise<boolean> {
    const result = await this.db.rentalBooking.updateMany({
      where: { id, status: RentalBookingStatus.CONFIRMED },
      data: { status: RentalBookingStatus.ACTIVE, actualPickupAt: new Date() },
    });
    return result.count === 1;
  }

  async markReturned(
    id: string,
    actualReturnAt: Date,
    lateFee: number,
    totalAmount: number,
  ): Promise<boolean> {
    const result = await this.db.rentalBooking.updateMany({
      where: { id, status: RentalBookingStatus.ACTIVE },
      data: { status: RentalBookingStatus.COMPLETED, actualReturnAt, lateFee, totalAmount },
    });
    return result.count === 1;
  }

  /** Free cancellation: owner, still CONFIRMED, and before the pickup time. */
  async cancel(id: string, userId: string, now: Date): Promise<boolean> {
    const result = await this.db.rentalBooking.updateMany({
      where: { id, userId, status: RentalBookingStatus.CONFIRMED, pickupAt: { gt: now } },
      data: { status: RentalBookingStatus.CANCELLED, refundedAt: now },
    });
    return result.count === 1;
  }

  async codeExists(code: string): Promise<boolean> {
    const row = await this.db.rentalBooking.findUnique({ where: { code }, select: { id: true } });
    return row !== null;
  }
}
