import { Inject, Injectable } from '@nestjs/common';
import {
  ServiceBookingStatus,
  type HomeService,
  type Prisma,
  type PromoCode,
  type ServiceLocation,
} from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';
import {
  bookingInclude,
  type ServiceBookingRow,
} from '@/modules/home-services/home-services.repository';

/** Statuses a booking is still "open" in — work that has not finished or been dropped. */
export const OPEN_STATUSES: ServiceBookingStatus[] = [
  ServiceBookingStatus.PENDING,
  ServiceBookingStatus.CONFIRMED,
  ServiceBookingStatus.IN_PROGRESS,
];

export const professionalInclude = {
  location: { select: { id: true, area: true, district: true } },
} satisfies Prisma.ProfessionalInclude;

export type ProfessionalRow = Prisma.ProfessionalGetPayload<{
  include: typeof professionalInclude;
}>;

/** Everything the admin panel reads and writes, in one place. */
@Injectable()
export class AdminRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  // ── services ──
  async services(): Promise<HomeService[]> {
    return this.db.homeService.findMany({ orderBy: [{ vertical: 'asc' }, { name: 'asc' }] });
  }
  async service(id: string): Promise<HomeService | null> {
    return this.db.homeService.findUnique({ where: { id } });
  }
  async createService(data: Prisma.HomeServiceCreateInput): Promise<HomeService> {
    return this.db.homeService.create({ data });
  }
  async updateService(id: string, data: Prisma.HomeServiceUpdateInput): Promise<HomeService> {
    return this.db.homeService.update({ where: { id }, data });
  }
  async deleteService(id: string): Promise<void> {
    await this.db.homeService.delete({ where: { id } });
  }
  async openBookingsByService(): Promise<Map<string, number>> {
    const rows = await this.db.serviceBooking.groupBy({
      by: ['serviceId'],
      where: { status: { in: OPEN_STATUSES }, serviceId: { not: null } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.serviceId!, r._count._all]));
  }

  // ── locations ──
  async locations(): Promise<ServiceLocation[]> {
    return this.db.serviceLocation.findMany({ orderBy: [{ district: 'asc' }, { area: 'asc' }] });
  }
  async location(id: string): Promise<ServiceLocation | null> {
    return this.db.serviceLocation.findUnique({ where: { id } });
  }
  async createLocation(data: Prisma.ServiceLocationCreateInput): Promise<ServiceLocation> {
    return this.db.serviceLocation.create({ data });
  }
  async updateLocation(
    id: string,
    data: Prisma.ServiceLocationUpdateInput,
  ): Promise<ServiceLocation> {
    return this.db.serviceLocation.update({ where: { id }, data });
  }
  async professionalsByLocation(): Promise<Map<string, number>> {
    const rows = await this.db.professional.groupBy({
      by: ['locationId'],
      where: { locationId: { not: null } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.locationId!, r._count._all]));
  }
  async pendingByLocation(): Promise<Map<string, number>> {
    const rows = await this.db.serviceBooking.groupBy({
      by: ['locationId'],
      where: { status: ServiceBookingStatus.PENDING, locationId: { not: null } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.locationId!, r._count._all]));
  }

  // ── professionals ──
  async professionals(): Promise<ProfessionalRow[]> {
    return this.db.professional.findMany({
      include: professionalInclude,
      orderBy: { name: 'asc' },
    });
  }
  async professional(id: string): Promise<ProfessionalRow | null> {
    return this.db.professional.findUnique({ where: { id }, include: professionalInclude });
  }
  async createProfessional(
    data: Prisma.ProfessionalUncheckedCreateInput,
  ): Promise<ProfessionalRow> {
    return this.db.professional.create({ data, include: professionalInclude });
  }
  async updateProfessional(
    id: string,
    data: Prisma.ProfessionalUncheckedUpdateInput,
  ): Promise<ProfessionalRow> {
    return this.db.professional.update({ where: { id }, data, include: professionalInclude });
  }
  async deleteProfessional(id: string): Promise<void> {
    await this.db.professional.delete({ where: { id } });
  }
  /** Professionals with a job under way right now. */
  async professionalsOnJob(): Promise<Set<string>> {
    const rows = await this.db.serviceBooking.findMany({
      where: { status: ServiceBookingStatus.IN_PROGRESS, professionalId: { not: null } },
      select: { professionalId: true },
    });
    return new Set(rows.map((r) => r.professionalId!));
  }
  async jobsOnDay(day: Date): Promise<Map<string, number>> {
    const rows = await this.db.serviceBooking.groupBy({
      by: ['professionalId'],
      where: {
        scheduledDate: day,
        professionalId: { not: null },
        status: { not: ServiceBookingStatus.CANCELLED },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.professionalId!, r._count._all]));
  }
  async hasActiveAssignments(professionalId: string): Promise<boolean> {
    const count = await this.db.serviceBooking.count({
      where: {
        professionalId,
        status: { in: [ServiceBookingStatus.CONFIRMED, ServiceBookingStatus.IN_PROGRESS] },
      },
    });
    return count > 0;
  }

  // ── promo codes ──
  async promoCodes(): Promise<PromoCode[]> {
    return this.db.promoCode.findMany({ orderBy: { createdAt: 'desc' } });
  }
  async promoCode(id: string): Promise<PromoCode | null> {
    return this.db.promoCode.findUnique({ where: { id } });
  }
  async promoCodeByCode(code: string): Promise<PromoCode | null> {
    return this.db.promoCode.findUnique({ where: { code } });
  }
  async createPromoCode(data: Prisma.PromoCodeCreateInput): Promise<PromoCode> {
    return this.db.promoCode.create({ data });
  }
  async updatePromoCode(id: string, data: Prisma.PromoCodeUpdateInput): Promise<PromoCode> {
    return this.db.promoCode.update({ where: { id }, data });
  }
  async deletePromoCode(id: string): Promise<void> {
    await this.db.promoCode.delete({ where: { id } });
  }

  // ── bookings ──
  async bookings(status?: ServiceBookingStatus, take = 500): Promise<ServiceBookingRow[]> {
    return this.db.serviceBooking.findMany({
      where: status ? { status } : {},
      include: bookingInclude,
      orderBy: [{ scheduledDate: 'desc' }, { timeSlot: 'asc' }],
      take,
    });
  }
  async bookingsWhere(where: Prisma.ServiceBookingWhereInput): Promise<ServiceBookingRow[]> {
    return this.db.serviceBooking.findMany({
      where,
      include: bookingInclude,
      orderBy: [{ scheduledDate: 'asc' }, { timeSlot: 'asc' }],
    });
  }
  async countBookings(where: Prisma.ServiceBookingWhereInput): Promise<number> {
    return this.db.serviceBooking.count({ where });
  }
  async sumTotals(where: Prisma.ServiceBookingWhereInput): Promise<number> {
    const agg = await this.db.serviceBooking.aggregate({ where, _sum: { totalAmount: true } });
    return Number(agg._sum.totalAmount ?? 0);
  }
}
