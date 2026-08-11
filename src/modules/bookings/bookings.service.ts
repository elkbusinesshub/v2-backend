import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DomainException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import { resolveSlot } from '@/modules/services/booking-window';
import { ServicesRepository } from '@/modules/services/services.repository';
import { BookingConfirmationDto, BookingListItemDto, CreateBookingDto } from './bookings.dto';
import { BookingsRepository } from './bookings.repository';
import { UnifiedBookingsRepository } from './unified-bookings.repository';

const REFERENCE_ATTEMPTS = 3;

@Injectable()
export class BookingsService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly services: ServicesRepository,
    private readonly unified: UnifiedBookingsRepository,
  ) {}

  async create(userId: string, dto: CreateBookingDto): Promise<BookingConfirmationDto> {
    const service = await this.services.findById(dto.serviceId);
    if (!service) {
      throw new ResourceNotFoundException('Service');
    }

    const slot = resolveSlot(dto.day, dto.time);
    if (!slot) {
      throw new ValidationFailedException([
        { field: 'day', message: 'Selected date/time is outside the offered booking window' },
      ]);
    }

    // Client-sent total is ignored — the service price is the source of truth.
    const price = service.price;

    const booking = await this.createWithReference({
      userId,
      serviceId: service.id,
      scheduledAt: slot.scheduledAt,
      addressText: dto.address,
      lat: dto.lat ?? null,
      lng: dto.lng ?? null,
      serviceFee: price,
      total: price,
    });

    return {
      bookingReference: booking.reference,
      serviceName: service.name,
      dateTimeLabel: `${slot.weekday} ${dto.day}, ${dto.time}`,
      providerName: service.providerName,
      amountPaid: price.toNumber(),
    };
  }

  /** Every vertical's bookings in one list, newest first. */
  async list(userId: string): Promise<BookingListItemDto[]> {
    const bookings = await this.unified.findAllByUser(userId);
    return bookings.map((b) => ({
      id: b.id,
      vertical: b.vertical,
      reference: b.reference,
      serviceName: b.serviceName,
      serviceIcon: b.serviceIcon,
      providerName: b.providerName,
      status: b.status,
      scheduledAt: b.scheduledAt?.toISOString() ?? null,
      addressText: b.addressText,
      total: b.total,
    }));
  }

  async cancel(userId: string, id: string): Promise<void> {
    const booking = await this.bookings.findByIdForUser(id, userId);
    if (!booking) {
      throw new ResourceNotFoundException('Booking');
    }
    const cancelled = await this.bookings.cancel(id);
    if (!cancelled) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'BOOKING_NOT_CANCELLABLE',
        'Only upcoming confirmed bookings can be cancelled',
      );
    }
  }

  /** Ops marks the job done (admin-only until crew assignment exists). */
  async complete(id: string): Promise<void> {
    const completed = await this.bookings.markCompleted(id);
    if (!completed) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        'Only a confirmed booking can be completed',
      );
    }
  }

  /** Retries on the (unlikely) reference collision instead of surfacing a 409. */
  private async createWithReference(data: Omit<Prisma.BookingUncheckedCreateInput, 'reference'>) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.bookings.create({ ...data, reference: generateReference() });
      } catch (err) {
        const isReferenceCollision =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        if (!isReferenceCollision || attempt >= REFERENCE_ATTEMPTS) {
          throw err;
        }
      }
    }
  }
}

/** e.g. ELK-2026-48213 */
function generateReference(): string {
  return `ELK-${new Date().getFullYear()}-${randomInt(0, 100000).toString().padStart(5, '0')}`;
}
