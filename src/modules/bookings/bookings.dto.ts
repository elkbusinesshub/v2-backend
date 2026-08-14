import type { BookingVertical } from './unified-bookings.repository';

export class BookingListItemDto {
  id!: string;
  /**
   * Which vertical the booking belongs to. The app needs it to route a cancel:
   * porter and rides own theirs, and everything else is a listing order.
   */
  vertical!: BookingVertical;
  reference!: string;
  serviceName!: string;
  serviceIcon!: string;
  providerName!: string;
  /** Each vertical has its own status enum; they share CONFIRMED/COMPLETED/CANCELLED. */
  status!: string;
  /** Null for a booking with no date yet (an immediate porter pickup). */
  scheduledAt!: string | null;
  addressText!: string;
  total!: number;
}
