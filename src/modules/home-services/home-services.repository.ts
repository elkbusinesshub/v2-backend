import { Inject, Injectable } from '@nestjs/common';
import type {
  HomeService,
  Prisma,
  PromoCode,
  ServiceLocation,
  ServiceVertical,
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

  /** Services the app shows: active and online. */
  async listLive(vertical?: ServiceVertical): Promise<HomeService[]> {
    return this.db.homeService.findMany({
      where: { active: true, online: true, ...(vertical ? { vertical } : {}) },
      orderBy: [{ vertical: 'asc' }, { name: 'asc' }],
    });
  }

  async findService(id: string): Promise<HomeService | null> {
    return this.db.homeService.findUnique({ where: { id } });
  }

  async findPromo(code: string): Promise<PromoCode | null> {
    return this.db.promoCode.findUnique({ where: { code: code.trim().toUpperCase() } });
  }

  async activeAreas(): Promise<ServiceLocation[]> {
    return this.db.serviceLocation.findMany({ where: { active: true } });
  }

  async createBooking(data: Prisma.ServiceBookingUncheckedCreateInput): Promise<ServiceBookingRow> {
    return this.db.serviceBooking.create({ data, include: bookingInclude });
  }

  async findBooking(id: string): Promise<ServiceBookingRow | null> {
    return this.db.serviceBooking.findUnique({ where: { id }, include: bookingInclude });
  }

  async updateBooking(
    id: string,
    data: Prisma.ServiceBookingUncheckedUpdateInput,
  ): Promise<ServiceBookingRow> {
    return this.db.serviceBooking.update({ where: { id }, data, include: bookingInclude });
  }
}
