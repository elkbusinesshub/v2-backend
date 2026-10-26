import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

/**
 * The vertical a booking came from. The app uses this to route a cancel to the
 * right endpoint: listing orders and ELK's own services each have their own.
 */
export const BOOKING_VERTICALS = [
  /**
   * An order placed against a seller's listing. Home services, cleaning,
   * repair, rental and stay bookings are all this now — the vertical screens
   * still look different, but every one of them writes an `ad_order`. Its
   * cancel lives on the marketplace endpoint rather than a per-vertical one.
   */
  'marketplace',
  /**
   * ELK's own cleaning and repair services, booked from the admin's catalogue
   * and fulfilled by a professional the admin assigns. Cancelled through
   * `POST /service-bookings/:id/cancel`.
   */
  'service',
] as const;
export type BookingVertical = (typeof BOOKING_VERTICALS)[number];

/** One row of the unified "My Bookings" list, whichever table it came from. */
export interface UnifiedBooking {
  id: string;
  vertical: BookingVertical;
  reference: string;
  serviceName: string;
  serviceIcon: string;
  providerName: string;
  status: string;
  /**
   * Which category of listing this was, e.g. `cleaning` or `elkstay`, so the
   * app can group My Bookings the way the user shops.
   */
  categorySlug: string;
  /** Null for a booking with no date yet. */
  scheduledAt: Date | null;
  addressText: string;
  total: number;
  createdAt: Date;
}

/**
 * Reads a user's bookings across the two tables that hold them: orders against
 * a seller's listing, and ELK's own cleaning and repair bookings. This maps
 * both onto one shape.
 */
@Injectable()
export class UnifiedBookingsRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async findAllByUser(userId: string): Promise<UnifiedBooking[]> {
    const [adOrders, serviceBookings] = await Promise.all([
      // Scoped to the buyer: a seller's own listings appear in their Orders
      // tab, not in the list of things they have booked.
      this.db.adOrder.findMany({
        where: { buyerId: userId },
        include: {
          ad: { select: { icon: true, categorySlug: true } },
          seller: { select: { name: true } },
        },
      }),
      // A checkout the customer never paid is not a booking they made.
      this.db.serviceBooking.findMany({
        where: { userId, status: { not: 'AWAITING_PAYMENT' } },
        include: { professional: { select: { name: true } } },
      }),
    ]);

    const rows: UnifiedBooking[] = [
      ...adOrders.map((o) => ({
        id: o.id,
        vertical: 'marketplace' as const,
        reference: o.code,
        serviceName: o.serviceName,
        serviceIcon: o.ad.icon,
        // The person who will actually do the work, rather than a house brand.
        providerName: o.seller.name ?? 'ELK Seller',
        status: o.status,
        categorySlug: o.ad.categorySlug,
        scheduledAt: o.scheduledAt,
        addressText: o.addressText,
        total: Number(o.amount),
        createdAt: o.createdAt,
      })),
      ...serviceBookings.map((b) => ({
        id: b.id,
        vertical: 'service' as const,
        reference: b.code,
        serviceName: b.serviceName,
        serviceIcon: b.vertical === 'REPAIR' ? '🔧' : '🧹',
        // Named once the admin assigns someone.
        providerName:
          b.professional?.name ??
          b.professionalName ??
          (b.vertical === 'REPAIR' ? 'ELK Repair' : 'ELK Clean'),
        status: b.status,
        // The same slugs the listings use, so My Bookings groups them alike.
        categorySlug: b.vertical === 'REPAIR' ? 'repairing' : 'cleaning',
        scheduledAt: new Date(
          `${b.scheduledDate.toISOString().slice(0, 10)}T${b.timeSlot}:00+05:30`,
        ),
        addressText: b.addressText,
        total: Number(b.totalAmount),
        createdAt: b.createdAt,
      })),
    ];

    // Newest first by the date the user cares about, falling back to when the
    // booking was made for anything without a schedule.
    return rows.sort(
      (a, b) => (b.scheduledAt ?? b.createdAt).getTime() - (a.scheduledAt ?? a.createdAt).getTime(),
    );
  }
}
