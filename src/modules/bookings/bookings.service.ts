import { Injectable } from '@nestjs/common';
import { BookingListItemDto } from './bookings.dto';
import { UnifiedBookingsRepository } from './unified-bookings.repository';

@Injectable()
export class BookingsService {
  constructor(private readonly unified: UnifiedBookingsRepository) {}

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
}
