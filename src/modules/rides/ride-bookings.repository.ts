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

  /** Unscoped — for the partner's side, which is not the rider. */
  async findById(id: string): Promise<RideBookingWithType | null> {
    return this.db.rideBooking.findFirst({ where: { id }, include: WITH_TYPE });
  }

  /** The trip a partner is working, if any. */
  async findForDriver(driverId: string): Promise<RideBookingWithType | null> {
    return this.db.rideBooking.findFirst({
      where: {
        driverId,
        status: { in: [RideBookingStatus.CONFIRMED, RideBookingStatus.IN_PROGRESS] },
      },
      include: WITH_TYPE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Assigns the partner who accepted — but only while the trip is still on
   * offer, so the second partner through the door changes nothing.
   */
  async assignDriver(
    id: string,
    driver: {
      driverId: string;
      driverName: string;
      vehicleLabel: string;
      plateNumber: string;
      otpCode: string;
    },
  ): Promise<boolean> {
    const result = await this.db.rideBooking.updateMany({
      where: { id, status: RideBookingStatus.SEARCHING },
      data: { ...driver, status: RideBookingStatus.CONFIRMED },
    });
    return result.count === 1;
  }

  /** Nobody took it. Only meaningful while it was still on offer. */
  async markNoDrivers(id: string): Promise<boolean> {
    const result = await this.db.rideBooking.updateMany({
      where: { id, status: RideBookingStatus.SEARCHING },
      data: { status: RideBookingStatus.NO_DRIVERS },
    });
    return result.count === 1;
  }

  /** The partner starts the trip, having been given the rider's code. */
  async startByDriver(id: string, driverId: string): Promise<boolean> {
    const result = await this.db.rideBooking.updateMany({
      where: { id, driverId, status: RideBookingStatus.CONFIRMED },
      data: { status: RideBookingStatus.IN_PROGRESS, startedAt: new Date() },
    });
    return result.count === 1;
  }

  async completeByDriver(id: string, driverId: string): Promise<boolean> {
    const result = await this.db.rideBooking.updateMany({
      where: { id, driverId, status: RideBookingStatus.IN_PROGRESS },
      data: { status: RideBookingStatus.COMPLETED, completedAt: new Date() },
    });
    return result.count === 1;
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
      // Also cancellable while still searching: a rider who gives up waiting
      // must not be stuck until the offer window closes on its own.
      where: {
        id,
        userId,
        status: { in: [RideBookingStatus.SEARCHING, RideBookingStatus.CONFIRMED] },
      },
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
