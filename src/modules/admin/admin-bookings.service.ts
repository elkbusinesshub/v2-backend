import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ProfessionalStatus,
  ServiceBookingStatus,
  ServiceVertical,
  type WhatsappMessage,
} from '@prisma/client';
import { DomainException, ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import type { ServiceBookingDto } from '@/modules/home-services/home-services.dto';
import { isoDay, toBookingJson } from '@/modules/home-services/home-services.mapper';
import {
  HomeServicesRepository,
  type ServiceBookingRow,
} from '@/modules/home-services/home-services.repository';
import { todayInIndia } from '@/modules/home-services/home-services.rules';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { RazorpayService } from '@/modules/razorpay/razorpay.service';
import { WalletService } from '@/modules/wallet/wallet.service';
import { jobMessageParams } from '@/modules/whatsapp/job-message';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';
import { assertVertical } from './admin-scope';
import { AdminRepository, type ProfessionalRow } from './admin.repository';

const { AWAITING_PAYMENT, PENDING, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED } =
  ServiceBookingStatus;

/** Where the admin may move a booking from each status. Confirming is done by assigning. */
const TRANSITIONS: Record<ServiceBookingStatus, ServiceBookingStatus[]> = {
  [AWAITING_PAYMENT]: [],
  [PENDING]: [CANCELLED],
  [CONFIRMED]: [IN_PROGRESS, CANCELLED],
  [IN_PROGRESS]: [COMPLETED],
  [COMPLETED]: [],
  [CANCELLED]: [],
};

const NOTIFICATION_COLOR = 0xffe0f7f5;

/** The last WhatsApp sent to the professional about a booking. */
export interface WhatsappStatusDto {
  status: WhatsappMessage['status'];
  to: string;
  sentAt: string;
  error: string | null;
}

/** A booking as a company sees it: with how the professional was told. */
export type AdminBookingDto = ServiceBookingDto & { whatsapp: WhatsappStatusDto | null };

export interface DashboardDto {
  monthBookings: number;
  monthRevenue: number;
  pendingCount: number;
  servicesLive: number;
  servicesTotal: number;
  activeDistricts: number;
  team: { available: number; onJob: number; awaitingApproval: number };
  pending: AdminBookingDto[];
  todayJobs: AdminBookingDto[];
}

/**
 * A company's bookings: those whose address fell in one of its areas. Each
 * is confirmed by assigning one of its approved professionals, who is then
 * sent the job by WhatsApp.
 */
@Injectable()
export class AdminBookingsService {
  private readonly logger = new Logger(AdminBookingsService.name);

  constructor(
    private readonly repo: AdminRepository,
    private readonly bookings: HomeServicesRepository,
    private readonly notifications: NotificationsService,
    private readonly whatsapp: WhatsappService,
    private readonly wallet: WalletService,
    private readonly razorpay: RazorpayService,
  ) {}

  async list(
    companyId: string,
    status: ServiceBookingStatus | undefined,
    verticals: ServiceVertical[],
  ): Promise<AdminBookingDto[]> {
    return this.withWhatsapp(await this.repo.bookings(companyId, status, verticals));
  }

  /**
   * Assigning an approved professional confirms the booking, and sends them
   * the job on WhatsApp. The assignment stands whether or not the message
   * goes; its result comes back on the booking, and resend() tries again.
   */
  async assign(
    companyId: string,
    id: string,
    professionalId: string,
    verticals: ServiceVertical[],
  ): Promise<AdminBookingDto> {
    const booking = await this.require(companyId, id);
    assertVertical(booking.vertical, verticals);
    if (booking.status !== PENDING && booking.status !== CONFIRMED) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        `A ${booking.status.toLowerCase().replace('_', ' ')} booking cannot be reassigned`,
      );
    }
    const pro = await this.repo.professional(professionalId, companyId);
    if (!pro) throw new ResourceNotFoundException('Professional');
    if (pro.status !== ProfessionalStatus.APPROVED) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'NOT_APPROVED',
        `${pro.name} can be assigned once the super admin approves them`,
      );
    }
    if (!pro.categories.some((c) => c.category === booking.category)) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'WRONG_CATEGORY',
        `${pro.name} does not do ${booking.serviceName}`,
      );
    }
    const updated = await this.bookings.updateBooking(id, {
      professionalId,
      professionalName: pro.name,
      professionalPhone: pro.phone,
      status: CONFIRMED,
      confirmedAt: booking.confirmedAt ?? new Date(),
    });
    await this.notify(
      updated,
      booking.status === PENDING ? 'Booking confirmed' : 'Professional changed',
      `${pro.name} will come for your ${updated.serviceName} on ${updated.timeSlot}, ${this.day(updated)}.`,
    );
    const message = await this.sendJob(updated, pro, companyId);
    return { ...toBookingJson(updated), whatsapp: this.whatsappJson(message) };
  }

  /** Sends the job to the assigned professional again. */
  async resend(
    companyId: string,
    id: string,
    verticals: ServiceVertical[],
  ): Promise<AdminBookingDto> {
    const booking = await this.require(companyId, id);
    assertVertical(booking.vertical, verticals);
    if (
      !booking.professionalId ||
      (booking.status !== CONFIRMED && booking.status !== IN_PROGRESS)
    ) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'NOT_ASSIGNED',
        'Assign a professional before sending the job',
      );
    }
    const pro = await this.repo.professional(booking.professionalId, companyId);
    if (!pro) throw new ResourceNotFoundException('Professional');
    const message = await this.sendJob(booking, pro, companyId);
    return { ...toBookingJson(booking), whatsapp: this.whatsappJson(message) };
  }

  async setStatus(
    companyId: string,
    id: string,
    next: ServiceBookingStatus,
    verticals: ServiceVertical[],
  ): Promise<AdminBookingDto> {
    const booking = await this.require(companyId, id);
    assertVertical(booking.vertical, verticals);
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
    const updated =
      next === CANCELLED
        ? await this.bookings.cancelBooking(id, [booking.status])
        : await this.bookings.updateBooking(id, {
            status: next,
            ...(next === IN_PROGRESS ? { startedAt: now } : {}),
            ...(next === COMPLETED ? { completedAt: now } : {}),
          });
    if (!updated) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        'This booking just changed. Refresh and try again.',
      );
    }
    // The company cancelling is never the customer's fault: always a full refund.
    if (next === CANCELLED && updated.paymentMethod === 'razorpay') {
      await this.razorpay.refund(updated.id, Number(updated.totalAmount));
    } else if (next === CANCELLED) {
      await this.wallet.refundBooking(
        updated.userId,
        updated.paymentMethod,
        Number(updated.totalAmount),
        updated.serviceName,
      );
    }
    const message = {
      [IN_PROGRESS]: `Your ${updated.serviceName} has started.`,
      [COMPLETED]: `Your ${updated.serviceName} is done. Thank you for booking with ELK.`,
      [CANCELLED]: `Your ${updated.serviceName} on ${this.day(updated)} was cancelled.`,
    }[next as 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'];
    await this.notify(updated, `Booking ${next.toLowerCase().replace('_', ' ')}`, message);
    const [withStatus] = await this.withWhatsapp([updated]);
    return withStatus!;
  }

  /** The company's numbers, for the verticals the admin runs. */
  async dashboard(companyId: string, verticals: ServiceVertical[]): Promise<DashboardDto> {
    const mine = { companyId, vertical: { in: verticals } };
    const today = todayInIndia();
    const monthStart = new Date(`${today.slice(0, 8)}01T00:00:00+05:30`);
    const todayDate = new Date(`${today}T00:00:00.000Z`);
    const [monthBookings, monthRevenue, pending, todayJobs, allServices, locations, pros, onJob] =
      await Promise.all([
        this.repo.countBookings({
          ...mine,
          createdAt: { gte: monthStart },
          status: { notIn: [CANCELLED, AWAITING_PAYMENT] },
        }),
        this.repo.sumTotals({ ...mine, status: COMPLETED, completedAt: { gte: monthStart } }),
        this.repo.bookingsWhere({ ...mine, status: PENDING }),
        this.repo.bookingsWhere({
          ...mine,
          scheduledDate: todayDate,
          status: { in: [CONFIRMED, IN_PROGRESS] },
        }),
        this.repo.services(),
        this.repo.locations(companyId),
        this.repo.professionals(companyId),
        this.repo.professionalsOnJob(companyId),
      ]);
    const services = allServices.filter((s) => verticals.includes(s.vertical));
    const approved = pros.filter((p) => p.status === ProfessionalStatus.APPROVED);
    const busy = approved.filter((p) => onJob.has(p.id)).length;
    return {
      monthBookings,
      monthRevenue,
      pendingCount: pending.length,
      servicesLive: services.filter((s) => s.approved && s.active && s.online).length,
      servicesTotal: services.length,
      activeDistricts: new Set(locations.filter((l) => l.active).map((l) => l.district)).size,
      team: {
        available: approved.length - busy,
        onJob: busy,
        awaitingApproval: pros.filter((p) => p.status === ProfessionalStatus.PENDING).length,
      },
      pending: await this.withWhatsapp(pending),
      todayJobs: await this.withWhatsapp(todayJobs),
    };
  }

  /** A booking of this company; anyone else's is not found. */
  private async require(companyId: string, id: string): Promise<ServiceBookingRow> {
    const booking = await this.bookings.findBooking(id);
    if (!booking || booking.companyId !== companyId) throw new ResourceNotFoundException('Booking');
    return booking;
  }

  /** Sends the job to [pro] and records what happened. */
  private async sendJob(
    b: ServiceBookingRow,
    pro: ProfessionalRow,
    companyId: string,
  ): Promise<WhatsappMessage> {
    const companyName = (await this.repo.companyName(companyId)) ?? 'ELK';
    const params = jobMessageParams({
      professionalName: pro.name,
      companyName,
      serviceName: b.serviceName,
      date: isoDay(b.scheduledDate),
      timeSlot: b.timeSlot,
      hours: b.hours,
      professionals: b.professionals,
      withMaterials: b.withMaterials,
      extraLabel: b.vertical === ServiceVertical.REPAIR ? 'spare parts' : 'cleaning materials',
      customerName: b.user.name ?? 'ELK customer',
      customerPhone: b.contactPhone,
      addressLabel: b.addressLabel,
      addressText: b.addressText,
      lat: b.lat,
      lng: b.lng,
      directions: b.directions,
      bookingCode: b.code,
    });
    const result = await this.whatsapp.sendTemplate(pro.phone, params);
    this.logger.log(`job WhatsApp ${result.status.toLowerCase()}: booking=${b.id} to=${pro.phone}`);
    return this.repo.logWhatsapp({
      bookingId: b.id,
      professionalId: pro.id,
      toPhone: pro.phone,
      template: this.whatsapp.templateName,
      status: result.status,
      providerMessageId: result.messageId,
      error: result.error,
      sentById: companyId,
    });
  }

  private async withWhatsapp(rows: ServiceBookingRow[]): Promise<AdminBookingDto[]> {
    const last = await this.repo.lastWhatsapp(rows.map((r) => r.id));
    return rows.map((r) => ({ ...toBookingJson(r), whatsapp: this.whatsappJson(last.get(r.id)) }));
  }

  private whatsappJson(m: WhatsappMessage | undefined): WhatsappStatusDto | null {
    return m
      ? { status: m.status, to: m.toPhone, sentAt: m.createdAt.toISOString(), error: m.error }
      : null;
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
