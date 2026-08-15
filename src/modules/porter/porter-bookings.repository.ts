import { Inject, Injectable } from '@nestjs/common';
import { PorterBookingStatus, type Prisma } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';
import type { PorterBookingFull } from './porter.mapper';

const FULL_INCLUDE = { vehicle: true, addons: true } as const;

export interface CreatePorterBookingData {
  booking: Omit<Prisma.PorterBookingUncheckedCreateInput, 'id' | 'addons'>;
  addons: { addonId: string; label: string; price: number }[];
}

@Injectable()
export class PorterBookingsRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  /** Booking + addon snapshots in one atomic write. */
  async create(data: CreatePorterBookingData): Promise<PorterBookingFull> {
    return this.db.porterBooking.create({
      data: { ...data.booking, addons: { create: data.addons } },
      include: FULL_INCLUDE,
    });
  }

  async listForUser(userId: string): Promise<PorterBookingFull[]> {
    return this.db.porterBooking.findMany({
      where: { userId },
      include: FULL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findForUser(id: string, userId: string): Promise<PorterBookingFull | null> {
    return this.db.porterBooking.findFirst({ where: { id, userId }, include: FULL_INCLUDE });
  }

  async findById(id: string): Promise<PorterBookingFull | null> {
    return this.db.porterBooking.findFirst({ where: { id }, include: FULL_INCLUDE });
  }

  /**
   * Atomic status transitions — each succeeds only from the expected
   * previous status, so a double-tap or a race can never double-apply.
   */
  async cancel(id: string, userId: string): Promise<boolean> {
    const result = await this.db.porterBooking.updateMany({
      // Also while searching: a sender who gives up waiting must not be held
      // until the offer window closes on its own.
      where: {
        id,
        userId,
        status: { in: [PorterBookingStatus.SEARCHING, PorterBookingStatus.CONFIRMED] },
      },
      data: { status: PorterBookingStatus.CANCELLED, cancelledAt: new Date() },
    });
    return result.count === 1;
  }

  /** The partner a job was offered to and accepted. */
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
    const result = await this.db.porterBooking.updateMany({
      where: { id, status: PorterBookingStatus.SEARCHING },
      data: { ...driver, status: PorterBookingStatus.CONFIRMED },
    });
    return result.count === 1;
  }

  async markNoDrivers(id: string): Promise<boolean> {
    const result = await this.db.porterBooking.updateMany({
      where: { id, status: PorterBookingStatus.SEARCHING },
      data: { status: PorterBookingStatus.NO_DRIVERS },
    });
    return result.count === 1;
  }

  /** The job this partner is working, if any. */
  async findForDriver(driverId: string) {
    return this.db.porterBooking.findFirst({
      where: {
        driverId,
        status: { in: [PorterBookingStatus.CONFIRMED, PorterBookingStatus.PICKED_UP] },
      },
      include: FULL_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** The partner collects the parcel, with the code the sender shows them. */
  async pickUpByDriver(id: string, driverId: string): Promise<boolean> {
    const result = await this.db.porterBooking.updateMany({
      where: { id, driverId, status: PorterBookingStatus.CONFIRMED },
      data: { status: PorterBookingStatus.PICKED_UP, pickedUpAt: new Date() },
    });
    return result.count === 1;
  }

  async deliverByDriver(id: string, driverId: string): Promise<boolean> {
    const result = await this.db.porterBooking.updateMany({
      where: { id, driverId, status: PorterBookingStatus.PICKED_UP },
      data: { status: PorterBookingStatus.DELIVERED, deliveredAt: new Date() },
    });
    return result.count === 1;
  }

  async markPickedUp(id: string): Promise<boolean> {
    const result = await this.db.porterBooking.updateMany({
      where: { id, status: PorterBookingStatus.CONFIRMED },
      data: { status: PorterBookingStatus.PICKED_UP, pickedUpAt: new Date() },
    });
    return result.count === 1;
  }

  async markDelivered(id: string): Promise<boolean> {
    const result = await this.db.porterBooking.updateMany({
      where: { id, status: PorterBookingStatus.PICKED_UP },
      data: { status: PorterBookingStatus.DELIVERED, deliveredAt: new Date() },
    });
    return result.count === 1;
  }

  async codeExists(code: string): Promise<boolean> {
    const row = await this.db.porterBooking.findUnique({ where: { code }, select: { id: true } });
    return row !== null;
  }
}
