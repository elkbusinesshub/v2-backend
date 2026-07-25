import { Inject, Injectable } from '@nestjs/common';
import { Prisma, StayBookingStatus, StayBookingType, type StayBooking } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';
import type { BookingWithStay } from './elkstay.mapper';

@Injectable()
export class StayBookingsRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  /** Cancelled bookings never appear in the app's tabs. */
  async listForUser(userId: string): Promise<BookingWithStay[]> {
    return this.db.stayBooking.findMany({
      where: { userId, status: { not: StayBookingStatus.CANCELLED } },
      include: { stay: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findForUser(id: string, userId: string): Promise<BookingWithStay | null> {
    return this.db.stayBooking.findFirst({
      where: { id, userId },
      include: { stay: true },
    });
  }

  async create(data: Prisma.StayBookingUncheckedCreateInput): Promise<BookingWithStay> {
    return this.db.stayBooking.create({ data, include: { stay: true } });
  }

  /** True if the user already has an un-cancelled visit request for this stay. */
  async hasActiveVisit(userId: string, stayId: string): Promise<boolean> {
    const row = await this.db.stayBooking.findFirst({
      where: {
        userId,
        stayId,
        type: StayBookingType.VISIT,
        status: StayBookingStatus.VISIT_BOOKED,
      },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * Atomic owner-scoped cancellation: succeeds only while the booking is
   * still in a cancellable status — no read-then-write race.
   */
  async cancel(id: string, userId: string, cancellable: StayBookingStatus[]): Promise<boolean> {
    const result = await this.db.stayBooking.updateMany({
      where: { id, userId, status: { in: cancellable } },
      data: { status: StayBookingStatus.CANCELLED },
    });
    return result.count === 1;
  }

  async codeExists(code: string): Promise<boolean> {
    const row = await this.db.stayBooking.findUnique({ where: { code }, select: { id: true } });
    return row !== null;
  }

  async findByCode(code: string): Promise<StayBooking | null> {
    return this.db.stayBooking.findUnique({ where: { code } });
  }
}
