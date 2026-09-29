import { Inject, Injectable } from '@nestjs/common';
import { ServiceBookingStatus, UserType, type Prisma } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';
import {
  bookingInclude,
  type ServiceBookingRow,
} from '@/modules/home-services/home-services.repository';
import { professionalInclude, type ProfessionalRow } from '@/modules/admin/admin.repository';
import type { JobView } from './pro.dto';

const { CONFIRMED, IN_PROGRESS, COMPLETED } = ServiceBookingStatus;

/** What a professional reads and changes about themselves and their jobs. */
@Injectable()
export class ProRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async byUser(userId: string): Promise<ProfessionalRow | null> {
    return this.db.professional.findUnique({ where: { userId }, include: professionalInclude });
  }

  /**
   * An account made PROFESSIONAL straight in the database has no professional
   * row yet; this creates one from the account, so it can sign in and work.
   * Null for any other account.
   */
  async createForAccount(userId: string): Promise<ProfessionalRow | null> {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user || user.userType !== UserType.PROFESSIONAL || !user.phone) return null;
    const digits = user.phone.replace(/\D/g, '').slice(-10);
    return this.db.professional.create({
      data: {
        name: user.name ?? 'ELK professional',
        phone: `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`,
        userId,
      },
      include: professionalInclude,
    });
  }

  async setDuty(id: string, onDuty: boolean): Promise<ProfessionalRow> {
    return this.db.professional.update({
      where: { id },
      data: { onDuty },
      include: professionalInclude,
    });
  }

  async jobs(professionalId: string, view: JobView, today: Date): Promise<ServiceBookingRow[]> {
    const where = this.viewWhere(professionalId, view, today);
    return this.db.serviceBooking.findMany({
      where,
      include: bookingInclude,
      orderBy:
        view === 'done'
          ? [{ completedAt: 'desc' }]
          : [{ scheduledDate: 'asc' }, { timeSlot: 'asc' }],
      take: view === 'done' ? 50 : undefined,
    });
  }

  async count(professionalId: string, view: JobView, today: Date): Promise<number> {
    return this.db.serviceBooking.count({ where: this.viewWhere(professionalId, view, today) });
  }

  async doneSince(professionalId: string, since: Date): Promise<number> {
    return this.db.serviceBooking.count({
      where: { professionalId, status: COMPLETED, completedAt: { gte: since } },
    });
  }

  private viewWhere(
    professionalId: string,
    view: JobView,
    today: Date,
  ): Prisma.ServiceBookingWhereInput {
    switch (view) {
      case 'today':
        return {
          professionalId,
          OR: [
            { scheduledDate: today, status: { in: [CONFIRMED, IN_PROGRESS, COMPLETED] } },
            // Started or confirmed on an earlier day and never finished.
            { scheduledDate: { lt: today }, status: { in: [CONFIRMED, IN_PROGRESS] } },
          ],
        };
      case 'upcoming':
        return { professionalId, scheduledDate: { gt: today }, status: CONFIRMED };
      case 'done':
        return { professionalId, status: COMPLETED };
    }
  }
}
