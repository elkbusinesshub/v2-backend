import { Inject, Injectable } from '@nestjs/common';
import {
  AdminModule,
  ServiceBookingStatus,
  UserType,
  type HomeService,
  type Prisma,
  type PromoCode,
  type ServiceLocation,
  type ServiceVertical,
} from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

/** What a booking row carries whenever it is read. */
export const bookingInclude = {
  user: { select: { name: true } },
  location: { select: { id: true, area: true, district: true, pincode: true } },
  professional: { select: { id: true, name: true, phone: true } },
} satisfies Prisma.ServiceBookingInclude;

export type ServiceBookingRow = Prisma.ServiceBookingGetPayload<{ include: typeof bookingInclude }>;

@Injectable()
export class HomeServicesRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  /** Services the app shows: approved, active and online. */
  async listLive(vertical?: ServiceVertical): Promise<HomeService[]> {
    return this.db.homeService.findMany({
      where: { approved: true, active: true, online: true, ...(vertical ? { vertical } : {}) },
      orderBy: [{ vertical: 'asc' }, { name: 'asc' }],
    });
  }

  async findService(id: string): Promise<HomeService | null> {
    return this.db.homeService.findUnique({ where: { id } });
  }

  async findPromo(code: string): Promise<PromoCode | null> {
    return this.db.promoCode.findUnique({ where: { code: code.trim().toUpperCase() } });
  }

  /**
   * Areas that can take a [vertical] booking: active, and owned by a company
   * that is still an ADMIN and runs that vertical (ELK Clean or ELK Repair).
   */
  async activeAreas(vertical: ServiceVertical): Promise<ServiceLocation[]> {
    const module = vertical === 'REPAIR' ? AdminModule.REPAIR : AdminModule.CLEAN;
    return this.db.serviceLocation.findMany({
      where: {
        active: true,
        company: {
          userType: UserType.ADMIN,
          deletedAt: null,
          adminModules: { some: { module } },
        },
      },
    });
  }

  async createBooking(data: Prisma.ServiceBookingUncheckedCreateInput): Promise<ServiceBookingRow> {
    return this.db.serviceBooking.create({ data, include: bookingInclude });
  }

  async findBooking(id: string): Promise<ServiceBookingRow | null> {
    return this.db.serviceBooking.findUnique({ where: { id }, include: bookingInclude });
  }

  /**
   * Cancels only from one of [from], so two cancels racing each other can't
   * both go through (and both refund). Null when it was no longer in [from].
   * [cancellationFee] is what the refund keeps back.
   */
  async cancelBooking(
    id: string,
    from: ServiceBookingStatus[],
    cancellationFee = 0,
  ): Promise<ServiceBookingRow | null> {
    const { count } = await this.db.serviceBooking.updateMany({
      where: { id, status: { in: from } },
      data: { status: ServiceBookingStatus.CANCELLED, cancelledAt: new Date(), cancellationFee },
    });
    return count === 1 ? this.findBooking(id) : null;
  }

  async updateBooking(
    id: string,
    data: Prisma.ServiceBookingUncheckedUpdateInput,
  ): Promise<ServiceBookingRow> {
    return this.db.serviceBooking.update({ where: { id }, data, include: bookingInclude });
  }
}
