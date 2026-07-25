import { Inject, Injectable } from '@nestjs/common';
import { RepairBookingStatus, type Prisma } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';
import type { RepairBookingFull } from './repair.mapper';

const FULL_INCLUDE = { items: true } as const;

export interface CreateRepairBookingData {
  booking: Omit<Prisma.RepairBookingUncheckedCreateInput, 'id' | 'items'>;
  items: {
    serviceId: string;
    name: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }[];
}

@Injectable()
export class RepairBookingsRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  /** Booking + line snapshots in one atomic write. */
  async create(data: CreateRepairBookingData): Promise<RepairBookingFull> {
    return this.db.repairBooking.create({
      data: { ...data.booking, items: { create: data.items } },
      include: FULL_INCLUDE,
    });
  }

  async listForUser(userId: string): Promise<RepairBookingFull[]> {
    return this.db.repairBooking.findMany({
      where: { userId },
      include: FULL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findForUser(id: string, userId: string): Promise<RepairBookingFull | null> {
    return this.db.repairBooking.findFirst({ where: { id, userId }, include: FULL_INCLUDE });
  }

  async findById(id: string): Promise<RepairBookingFull | null> {
    return this.db.repairBooking.findFirst({ where: { id }, include: FULL_INCLUDE });
  }

  /**
   * Free cancellation: owner, still CONFIRMED, and before the cutoff.
   * Atomic guard — a double-tap or a race can never double-cancel.
   */
  async cancel(id: string, userId: string, cutoff: Date): Promise<boolean> {
    const result = await this.db.repairBooking.updateMany({
      where: { id, userId, status: RepairBookingStatus.CONFIRMED, scheduledAt: { gt: cutoff } },
      data: { status: RepairBookingStatus.CANCELLED, cancelledAt: new Date() },
    });
    return result.count === 1;
  }

  /** Ops marks the job done — only a confirmed booking can complete. */
  async markCompleted(id: string): Promise<boolean> {
    const result = await this.db.repairBooking.updateMany({
      where: { id, status: RepairBookingStatus.CONFIRMED },
      data: { status: RepairBookingStatus.COMPLETED },
    });
    return result.count === 1;
  }

  async codeExists(code: string): Promise<boolean> {
    const row = await this.db.repairBooking.findUnique({ where: { code }, select: { id: true } });
    return row !== null;
  }
}
