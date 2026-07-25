import { Inject, Injectable } from '@nestjs/common';
import { CleanBookingStatus, type Prisma } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';
import type { CleanBookingFull } from './elkclean.mapper';

const FULL_INCLUDE = { items: true } as const;

export interface CreateCleanBookingData {
  booking: Omit<Prisma.CleanBookingUncheckedCreateInput, 'id' | 'items'>;
  items: {
    serviceId: string;
    name: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }[];
}

@Injectable()
export class CleanBookingsRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  /** Booking + line snapshots in one atomic write. */
  async create(data: CreateCleanBookingData): Promise<CleanBookingFull> {
    return this.db.cleanBooking.create({
      data: { ...data.booking, items: { create: data.items } },
      include: FULL_INCLUDE,
    });
  }

  async listForUser(userId: string): Promise<CleanBookingFull[]> {
    return this.db.cleanBooking.findMany({
      where: { userId },
      include: FULL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findForUser(id: string, userId: string): Promise<CleanBookingFull | null> {
    return this.db.cleanBooking.findFirst({ where: { id, userId }, include: FULL_INCLUDE });
  }

  async findById(id: string): Promise<CleanBookingFull | null> {
    return this.db.cleanBooking.findFirst({ where: { id }, include: FULL_INCLUDE });
  }

  /**
   * Free cancellation: owner, still CONFIRMED, and before the cutoff.
   * Atomic guard — a double-tap or a race can never double-cancel.
   */
  async cancel(id: string, userId: string, cutoff: Date): Promise<boolean> {
    const result = await this.db.cleanBooking.updateMany({
      where: { id, userId, status: CleanBookingStatus.CONFIRMED, scheduledAt: { gt: cutoff } },
      data: { status: CleanBookingStatus.CANCELLED, cancelledAt: new Date() },
    });
    return result.count === 1;
  }

  /** Ops marks the job done — only a confirmed booking can complete. */
  async markCompleted(id: string): Promise<boolean> {
    const result = await this.db.cleanBooking.updateMany({
      where: { id, status: CleanBookingStatus.CONFIRMED },
      data: { status: CleanBookingStatus.COMPLETED },
    });
    return result.count === 1;
  }

  async codeExists(code: string): Promise<boolean> {
    const row = await this.db.cleanBooking.findUnique({ where: { code }, select: { id: true } });
    return row !== null;
  }
}
