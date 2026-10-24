import { Inject, Injectable } from '@nestjs/common';
import {
  ProfessionalStatus,
  ServiceBookingStatus,
  ServiceVertical,
  type HomeService,
  type Prisma,
  type PromoCode,
  type ServiceLocation,
  type WhatsappMessage,
} from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';
import {
  bookingInclude,
  type ServiceBookingRow,
} from '@/modules/home-services/home-services.repository';

/** An interactive transaction, for writes that must land together. */
export type Tx = Parameters<Parameters<ExtendedPrismaClient['$transaction']>[0]>[0];

/** Statuses a booking is still "open" in — work that has not finished or been dropped. */
export const OPEN_STATUSES: ServiceBookingStatus[] = [
  ServiceBookingStatus.PENDING,
  ServiceBookingStatus.CONFIRMED,
  ServiceBookingStatus.IN_PROGRESS,
];

export const professionalInclude = {
  categories: { select: { category: true } },
  decidedBy: { select: { id: true, name: true, phone: true } },
} satisfies Prisma.ProfessionalInclude;

export type ProfessionalRow = Prisma.ProfessionalGetPayload<{
  include: typeof professionalInclude;
}>;

/**
 * Everything the admin panel reads and writes, in one place. A company (an
 * ADMIN account) sees and changes only its own areas, professionals and
 * bookings, so those take its id; services and promo codes are shared.
 */
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
  async createService(data: Prisma.HomeServiceCreateInput, tx: Tx = this.db): Promise<HomeService> {
    return tx.homeService.create({ data });
  }
  async updateService(
    id: string,
    data: Prisma.HomeServiceUpdateInput,
    tx: Tx = this.db,
  ): Promise<HomeService> {
    return tx.homeService.update({ where: { id }, data });
  }
  /** Deletes a service and withdraws its waiting request; decided ones stay as history. */
  async deleteService(id: string, tx?: Tx): Promise<void> {
    if (!tx) return this.db.$transaction((t) => this.deleteService(id, t));
    await tx.serviceChangeRequest.deleteMany({ where: { openFor: id } });
    await tx.homeService.delete({ where: { id } });
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
  async locations(companyId: string): Promise<ServiceLocation[]> {
    return this.db.serviceLocation.findMany({
      where: { companyId },
      orderBy: [{ district: 'asc' }, { area: 'asc' }],
    });
  }
  async location(id: string, companyId: string): Promise<ServiceLocation | null> {
    return this.db.serviceLocation.findFirst({ where: { id, companyId } });
  }
  async createLocation(data: Prisma.ServiceLocationUncheckedCreateInput): Promise<ServiceLocation> {
    return this.db.serviceLocation.create({ data });
  }
  async updateLocation(
    id: string,
    data: Prisma.ServiceLocationUpdateInput,
  ): Promise<ServiceLocation> {
    return this.db.serviceLocation.update({ where: { id }, data });
  }
  async pendingByLocation(companyId: string): Promise<Map<string, number>> {
    const rows = await this.db.serviceBooking.groupBy({
      by: ['locationId'],
      where: { companyId, status: ServiceBookingStatus.PENDING, locationId: { not: null } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.locationId!, r._count._all]));
  }

  // ── professionals ──
  async professionals(companyId: string): Promise<ProfessionalRow[]> {
    return this.db.professional.findMany({
      where: { companyId },
      include: professionalInclude,
      orderBy: { name: 'asc' },
    });
  }
  async professional(id: string, companyId: string): Promise<ProfessionalRow | null> {
    return this.db.professional.findFirst({
      where: { id, companyId },
      include: professionalInclude,
    });
  }
  async createProfessional(
    data: Omit<Prisma.ProfessionalUncheckedCreateInput, 'categories'>,
    categories: string[],
  ): Promise<ProfessionalRow> {
    return this.db.professional.create({
      data: { ...data, categories: { create: categories.map((category) => ({ category })) } },
      include: professionalInclude,
    });
  }
  /** Edits a professional; [categories], when given, replaces their categories. */
  async updateProfessional(
    id: string,
    data: Prisma.ProfessionalUncheckedUpdateInput,
    categories?: string[],
  ): Promise<ProfessionalRow> {
    return this.db.$transaction(async (tx) => {
      if (categories) {
        await tx.professionalCategory.deleteMany({ where: { professionalId: id } });
        await tx.professionalCategory.createMany({
          data: categories.map((category) => ({ professionalId: id, category })),
        });
      }
      return tx.professional.update({ where: { id }, data, include: professionalInclude });
    });
  }
  async deleteProfessional(id: string): Promise<void> {
    await this.db.professional.delete({ where: { id } });
  }
  /** The company's approved professionals who do [category]: the people a booking can go to. */
  async approvedFor(companyId: string, category: string): Promise<ProfessionalRow[]> {
    return this.db.professional.findMany({
      where: {
        companyId,
        status: ProfessionalStatus.APPROVED,
        categories: { some: { category } },
      },
      include: professionalInclude,
      orderBy: { name: 'asc' },
    });
  }
  /** Professionals with a job under way right now. */
  async professionalsOnJob(companyId: string): Promise<Set<string>> {
    const rows = await this.db.serviceBooking.findMany({
      where: { companyId, status: ServiceBookingStatus.IN_PROGRESS, professionalId: { not: null } },
      select: { professionalId: true },
    });
    return new Set(rows.map((r) => r.professionalId!));
  }
  async jobsOnDay(companyId: string, day: Date): Promise<Map<string, number>> {
    const rows = await this.db.serviceBooking.groupBy({
      by: ['professionalId'],
      where: {
        companyId,
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
  async bookings(
    companyId: string,
    status: ServiceBookingStatus | undefined,
    verticals: ServiceVertical[],
    take = 500,
  ): Promise<ServiceBookingRow[]> {
    return this.db.serviceBooking.findMany({
      where: {
        companyId,
        vertical: { in: verticals },
        // An unpaid Razorpay booking is not the company's to act on yet.
        status: status ?? { not: ServiceBookingStatus.AWAITING_PAYMENT },
      },
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
  async companyName(companyId: string): Promise<string | null> {
    const u = await this.db.user.findUnique({ where: { id: companyId }, select: { name: true } });
    return u?.name ?? null;
  }

  // ── WhatsApp log ──
  async logWhatsapp(data: Prisma.WhatsappMessageUncheckedCreateInput): Promise<WhatsappMessage> {
    return this.db.whatsappMessage.create({ data });
  }
  /** The last WhatsApp sent about each booking. */
  async lastWhatsapp(bookingIds: string[]): Promise<Map<string, WhatsappMessage>> {
    if (bookingIds.length === 0) return new Map();
    const rows = await this.db.whatsappMessage.findMany({
      where: { bookingId: { in: bookingIds } },
      orderBy: { createdAt: 'desc' },
    });
    const last = new Map<string, WhatsappMessage>();
    for (const r of rows) if (!last.has(r.bookingId)) last.set(r.bookingId, r);
    return last;
  }

  async countBookings(where: Prisma.ServiceBookingWhereInput): Promise<number> {
    return this.db.serviceBooking.count({ where });
  }
  async sumTotals(where: Prisma.ServiceBookingWhereInput): Promise<number> {
    const agg = await this.db.serviceBooking.aggregate({ where, _sum: { totalAmount: true } });
    return Number(agg._sum.totalAmount ?? 0);
  }
}
