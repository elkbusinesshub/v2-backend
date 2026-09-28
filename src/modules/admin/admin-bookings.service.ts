import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ServiceBookingStatus, ServiceVertical } from '@prisma/client';
import { DomainException, ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import type { ServiceBookingDto } from '@/modules/home-services/home-services.dto';
import { toBookingJson } from '@/modules/home-services/home-services.mapper';
import {
  HomeServicesRepository,
  type ServiceBookingRow,
} from '@/modules/home-services/home-services.repository';
import { todayInIndia } from '@/modules/home-services/home-services.rules';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { AdminRepository } from './admin.repository';

const { PENDING, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED } = ServiceBookingStatus;

/** Where the admin may move a booking from each status. Confirming is done by assigning. */
const TRANSITIONS: Record<ServiceBookingStatus, ServiceBookingStatus[]> = {
  [PENDING]: [CANCELLED],
  [CONFIRMED]: [IN_PROGRESS, CANCELLED],
  [IN_PROGRESS]: [COMPLETED],
  [COMPLETED]: [],
  [CANCELLED]: [],
};

const NOTIFICATION_COLOR = 0xffe0f7f5;

export interface DashboardDto {
  monthBookings: number;
  monthRevenue: number;
  pendingCount: number;
  servicesLive: number;
  servicesTotal: number;
  activeDistricts: number;
  team: { available: number; onJob: number; offDuty: number };
  pending: ServiceBookingDto[];
  todayJobs: ServiceBookingDto[];
}

@Injectable()
export class AdminBookingsService {
  private readonly logger = new Logger(AdminBookingsService.name);

  constructor(
    private readonly repo: AdminRepository,
    private readonly bookings: HomeServicesRepository,
    private readonly notifications: NotificationsService,
  ) {}

  async list(status?: ServiceBookingStatus): Promise<ServiceBookingDto[]> {
    return (await this.repo.bookings(status)).map(toBookingJson);
  }

  /** Assigning a professional is what confirms a pending booking. */
  async assign(id: string, professionalId: string): Promise<ServiceBookingDto> {
    const booking = await this.require(id);
    if (booking.status !== PENDING && booking.status !== CONFIRMED) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        `A ${booking.status.toLowerCase().replace('_', ' ')} booking cannot be reassigned`,
      );
    }
    const pro = await this.repo.professional(professionalId);
    if (!pro) throw new ResourceNotFoundException('Professional');
    if (!pro.onDuty) {
      throw new DomainException(HttpStatus.CONFLICT, 'OFF_DUTY', `${pro.name} is off duty`);
    }
    const updated = await this.bookings.updateBooking(id, {
      professionalId,
      status: CONFIRMED,
      confirmedAt: booking.confirmedAt ?? new Date(),
    });
    await this.notify(
      updated,
      booking.status === PENDING ? 'Booking confirmed' : 'Professional changed',
      `${pro.name} will come for your ${updated.serviceName} on ${updated.timeSlot}, ${this.day(updated)}.`,
    );
    return toBookingJson(updated);
  }

  async setStatus(id: string, next: ServiceBookingStatus): Promise<ServiceBookingDto> {
    const booking = await this.require(id);
    if (!TRANSITIONS[booking.status].includes(next)) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        `A ${booking.status.toLowerCase().replace('_', ' ')} booking cannot become ${next.toLowerCase().replace('_', ' ')}`,
      );
    }
    if (next === IN_PROGRESS && !booking.professionalId) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'NOT_ASSIGNED',
        'Assign a professional before starting the job',
      );
    }
    const now = new Date();
    const updated = await this.bookings.updateBooking(id, {
      status: next,
      ...(next === IN_PROGRESS ? { startedAt: now } : {}),
      ...(next === COMPLETED ? { completedAt: now } : {}),
      ...(next === CANCELLED ? { cancelledAt: now } : {}),
    });
    const message = {
      [IN_PROGRESS]: `Your ${updated.serviceName} has started.`,
      [COMPLETED]: `Your ${updated.serviceName} is done. Thank you for booking with ELK.`,
      [CANCELLED]: `Your ${updated.serviceName} on ${this.day(updated)} was cancelled.`,
    }[next as 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'];
    await this.notify(updated, `Booking ${next.toLowerCase().replace('_', ' ')}`, message);
    return toBookingJson(updated);
  }

  async dashboard(): Promise<DashboardDto> {
    const today = todayInIndia();
    const monthStart = new Date(`${today.slice(0, 8)}01T00:00:00+05:30`);
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const [monthBookings, monthRevenue, pending, todayJobs, services, locations, pros, onJob] =
      await Promise.all([
        this.repo.countBookings({ createdAt: { gte: monthStart }, status: { not: CANCELLED } }),
        this.repo.sumTotals({ status: COMPLETED, completedAt: { gte: monthStart } }),
        this.repo.bookingsWhere({ status: PENDING }),
        this.repo.bookingsWhere({
          scheduledDate: todayDate,
          status: { in: [CONFIRMED, IN_PROGRESS] },
        }),
        this.repo.services(),
        this.repo.locations(),
        this.repo.professionals(),
        this.repo.professionalsOnJob(),
      ]);
    const offDuty = pros.filter((p) => !p.onDuty).length;
    const busy = pros.filter((p) => p.onDuty && onJob.has(p.id)).length;
    return {
      monthBookings,
      monthRevenue,
      pendingCount: pending.length,
      servicesLive: services.filter((s) => s.active && s.online).length,
      servicesTotal: services.length,
      activeDistricts: new Set(locations.filter((l) => l.active).map((l) => l.district)).size,
      team: { available: pros.length - offDuty - busy, onJob: busy, offDuty },
      pending: pending.map(toBookingJson),
      todayJobs: todayJobs.map(toBookingJson),
    };
  }

  private async require(id: string): Promise<ServiceBookingRow> {
    const booking = await this.bookings.findBooking(id);
    if (!booking) throw new ResourceNotFoundException('Booking');
    return booking;
  }

  private day(b: ServiceBookingRow): string {
    return b.scheduledDate.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  }

  /** The customer hears about every change. A failed notification must not undo the change. */
  private async notify(b: ServiceBookingRow, title: string, message: string): Promise<void> {
    try {
      await this.notifications.create({
        userId: b.userId,
        icon: b.vertical === ServiceVertical.REPAIR ? '🔧' : '🧹',
        colorHex: NOTIFICATION_COLOR,
        title,
        message,
      });
    } catch (err) {
      this.logger.warn({ err, bookingId: b.id }, 'could not notify the customer');
    }
  }
}
