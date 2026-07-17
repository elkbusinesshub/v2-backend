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
import { BookingsRepository, BookingWithService } from './bookings.repository';

const REFERENCE_ATTEMPTS = 3;

@Injectable()
export class BookingsService {
  constructor(
    private readonly bookings: BookingsRepository,
    private readonly services: ServicesRepository,
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

  async list(userId: string): Promise<BookingListItemDto[]> {
    const bookings = await this.bookings.findAllByUser(userId);
    return bookings.map(toListItem);
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

function toListItem(booking: BookingWithService): BookingListItemDto {
  return {
    id: booking.id,
    reference: booking.reference,
    serviceName: booking.service.name,
    serviceIcon: booking.service.icon,
    providerName: booking.service.providerName,
    status: booking.status,
    scheduledAt: booking.scheduledAt.toISOString(),
    addressText: booking.addressText,
    total: booking.total.toNumber(),
  };
}
