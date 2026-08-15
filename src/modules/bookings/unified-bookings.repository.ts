import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

/**
 * The vertical a booking came from. The app uses this to route a cancel to the
 * right endpoint — porter and rides each own theirs, with their own rules, so
 * there is no single cancel that fits all three.
 */
export const BOOKING_VERTICALS = [
  'porter',
  'rides',
  /**
   * An order placed against a seller's listing. Home services, cleaning,
   * repair, rental and stay bookings are all this now — the vertical screens
   * still look different, but every one of them writes an `ad_order`. Its
   * cancel lives on the marketplace endpoint rather than a per-vertical one.
   */
  'marketplace',
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
  /** Null for a booking with no date yet (an unscheduled porter pickup). */
  scheduledAt: Date | null;
  addressText: string;
  total: number;
  createdAt: Date;
}

/**
 * Reads a user's bookings across the three systems that still hold them.
 *
 * Five verticals used to keep their own booking table with their own columns;
 * all five now write an `ad_order` against the seller's listing, so what is
 * left is porter, rides, and everything else. This maps the three onto one
 * shape.
 */
@Injectable()
export class UnifiedBookingsRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async findAllByUser(userId: string): Promise<UnifiedBooking[]> {
    const where = { userId };

    const [porters, rides, adOrders] = await Promise.all([
      this.db.porterBooking.findMany({ where, include: { vehicle: true } }),
      this.db.rideBooking.findMany({ where, include: { rideType: true } }),
      // Scoped to the buyer: a seller's own listings appear in their Orders
      // tab, not in the list of things they have booked.
      this.db.adOrder.findMany({
        where: { buyerId: userId },
        include: { ad: { select: { icon: true } }, seller: { select: { name: true } } },
      }),
    ]);

    const rows: UnifiedBooking[] = [
      ...porters.map((b) => ({
        id: b.id,
        vertical: 'porter' as const,
        reference: b.code,
        serviceName: `${b.vehicle.name} delivery`,
        serviceIcon: '📦',
        providerName: 'ELK Porter',
        status: b.status,
        // Null for "pickup now" jobs, which carry no scheduled time.
        scheduledAt: b.scheduledAt,
        addressText: `${b.pickupAddress} → ${b.dropAddress}`,
        total: Number(b.totalAmount),
        createdAt: b.createdAt,
      })),
      ...rides.map((b) => ({
        id: b.id,
        vertical: 'rides' as const,
        reference: b.code,
        serviceName: `${b.rideType.name} ride`,
        serviceIcon: '🚕',
        // Null until a driver accepts; the row still has to list.
        providerName: b.driverName ?? 'Finding a driver',
        status: b.status,
        scheduledAt: b.createdAt,
        addressText: `${b.pickupAddress} → ${b.dropAddress}`,
        total: Number(b.fare),
        createdAt: b.createdAt,
      })),
      ...adOrders.map((o) => ({
        id: o.id,
        vertical: 'marketplace' as const,
        reference: o.code,
        serviceName: o.serviceName,
        serviceIcon: o.ad.icon,
        // The person who will actually do the work, rather than a house brand.
        providerName: o.seller.name ?? 'ELK Seller',
        status: o.status,
        scheduledAt: o.scheduledAt,
        addressText: o.addressText,
        total: Number(o.amount),
        createdAt: o.createdAt,
      })),
    ];

    // Newest first by the date the user cares about, falling back to when the
    // booking was made for anything without a schedule.
    return rows.sort(
      (a, b) => (b.scheduledAt ?? b.createdAt).getTime() - (a.scheduledAt ?? a.createdAt).getTime(),
    );
  }
}
