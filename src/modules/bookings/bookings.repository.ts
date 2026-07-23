import { Inject, Injectable } from '@nestjs/common';
import { BookingStatus, type Booking, type Prisma } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

export type BookingWithService = Prisma.BookingGetPayload<{ include: { service: true } }>;

@Injectable()
export class BookingsRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async create(data: Prisma.BookingUncheckedCreateInput): Promise<Booking> {
    return this.db.booking.create({ data });
  }

  async findAllByUser(userId: string): Promise<BookingWithService[]> {
    return this.db.booking.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { service: true },
    });
  }

  /** Scoped to [userId] so a mismatched owner behaves exactly like "not found". */
  async findByIdForUser(id: string, userId: string): Promise<Booking | null> {
    return this.db.booking.findFirst({ where: { id, userId } });
  }

  /**
   * Atomically cancels a still-CONFIRMED booking. Returns false when the
   * booking was already cancelled/completed (or raced another cancel).
   */
  async cancel(id: string): Promise<boolean> {
    const result = await this.db.booking.updateMany({
      where: { id, status: BookingStatus.CONFIRMED },
      data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
    });
    return result.count === 1;
  }

  /** Ops marks the job done — only a confirmed booking can complete. */
  async markCompleted(id: string): Promise<boolean> {
    const result = await this.db.booking.updateMany({
      where: { id, status: BookingStatus.CONFIRMED },
      data: { status: BookingStatus.COMPLETED },
    });
    return result.count === 1;
  }
}
