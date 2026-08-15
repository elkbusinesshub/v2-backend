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
  /**
   * The listing's category (`cleaning`, `repairing`, `car_rental`, `elkstay`),
   * or `porter` / `taxi` for the two verticals that are not listings. Drives
   * the category filter on My Bookings.
   */
  categorySlug!: string;
  /** Null for a booking with no date yet (an immediate porter pickup). */
  scheduledAt!: string | null;
  addressText!: string;
  total!: number;
}
