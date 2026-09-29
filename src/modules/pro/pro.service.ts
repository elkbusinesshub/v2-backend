import { HttpStatus, Injectable } from '@nestjs/common';
import { ServiceBookingStatus } from '@prisma/client';
import {
  DomainException,
  ForbiddenResourceException,
  ResourceNotFoundException,
} from '@/common/errors/domain.exceptions';
import { AdminBookingsService } from '@/modules/admin/admin-bookings.service';
import type { ProfessionalRow } from '@/modules/admin/admin.repository';
import type { ServiceBookingDto } from '@/modules/home-services/home-services.dto';
import { isoDay, toBookingJson } from '@/modules/home-services/home-services.mapper';
import { HomeServicesRepository } from '@/modules/home-services/home-services.repository';
import { todayInIndia } from '@/modules/home-services/home-services.rules';
import type { JobView, ProProfileDto } from './pro.dto';
import { ProRepository } from './pro.repository';

const { CONFIRMED, IN_PROGRESS, COMPLETED } = ServiceBookingStatus;

/**
 * The professional's side of a booking: see the jobs assigned to them, start
 * one on its day, and mark it done. The customer is notified exactly as when
 * the admin does it, because the change goes through the same service.
 */
@Injectable()
export class ProService {
  constructor(
    private readonly repo: ProRepository,
    private readonly bookings: HomeServicesRepository,
    private readonly adminBookings: AdminBookingsService,
  ) {}

  async profile(userId: string): Promise<ProProfileDto> {
    return this.profileJson(await this.require(userId));
  }

  async setDuty(userId: string, onDuty: boolean): Promise<ProProfileDto> {
    const pro = await this.require(userId);
    return this.profileJson(await this.repo.setDuty(pro.id, onDuty));
  }

  async jobs(userId: string, view: JobView): Promise<ServiceBookingDto[]> {
    const pro = await this.require(userId);
    return (await this.repo.jobs(pro.id, view, this.today())).map(toBookingJson);
  }

  async job(userId: string, id: string): Promise<ServiceBookingDto> {
    return toBookingJson(await this.requireJob(userId, id));
  }

  async start(userId: string, id: string): Promise<ServiceBookingDto> {
    const job = await this.requireJob(userId, id);
    if (job.status !== CONFIRMED) throw this.cannot(job.status, 'started');
    const day = isoDay(job.scheduledDate);
    if (day > todayInIndia()) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'TOO_EARLY',
        `This job is on ${day}. You can start it that day.`,
      );
    }
    return this.adminBookings.setStatus(id, IN_PROGRESS);
  }

  async complete(userId: string, id: string): Promise<ServiceBookingDto> {
    const job = await this.requireJob(userId, id);
    if (job.status !== IN_PROGRESS) throw this.cannot(job.status, 'marked done');
    return this.adminBookings.setStatus(id, COMPLETED);
  }

  private async require(userId: string): Promise<ProfessionalRow> {
    const pro = (await this.repo.byUser(userId)) ?? (await this.repo.createForAccount(userId));
    if (!pro) throw new ForbiddenResourceException('This account is not a professional');
    return pro;
  }

  /** A job belongs to the professional it is assigned to; anyone else gets 404. */
  private async requireJob(userId: string, id: string) {
    const pro = await this.require(userId);
    const job = await this.bookings.findBooking(id);
    if (!job || job.professionalId !== pro.id) throw new ResourceNotFoundException('Job');
    return job;
  }

  private cannot(status: ServiceBookingStatus, action: string): DomainException {
    return new DomainException(
      HttpStatus.CONFLICT,
      'INVALID_TRANSITION',
      `A ${status.toLowerCase().replace('_', ' ')} job cannot be ${action}`,
    );
  }

  private today(): Date {
    return new Date(`${todayInIndia()}T00:00:00.000Z`);
  }

  private async profileJson(p: ProfessionalRow): Promise<ProProfileDto> {
    const today = this.today();
    const monthStart = new Date(`${todayInIndia().slice(0, 8)}01T00:00:00+05:30`);
    const [todayCount, upcoming, doneThisMonth, doneTotal] = await Promise.all([
      this.repo.count(p.id, 'today', today),
      this.repo.count(p.id, 'upcoming', today),
      this.repo.doneSince(p.id, monthStart),
      this.repo.count(p.id, 'done', today),
    ]);
    return {
      id: p.id,
      name: p.name,
      phone: p.phone,
      experienceYears: p.experienceYears,
      skills: p.skills,
      location: p.location,
      onDuty: p.onDuty,
      stats: { today: todayCount, upcoming, doneThisMonth, doneTotal },
    };
  }
}
