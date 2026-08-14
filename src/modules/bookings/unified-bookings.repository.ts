import { Inject, Injectable } from '@nestjs/common';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

/**
 * The vertical a booking came from. The app uses this to route a cancel to the
 * right endpoint — every vertical owns its own `POST .../bookings/:id/cancel`
 * with its own rules, so there is no single cancel that fits all of them.
 */
export const BOOKING_VERTICALS = [
  'services',
  'elkclean',
  'elkrep',
  'rentals',
  'porter',
  'rides',
  'elkstay',
  /**
   * An order placed against a seller's listing. Cleaning, repair, rental and
   * stay bookings are all this now — the vertical screens still look
   * different, but every one of them writes an `ad_order`. Its cancel lives
   * on the marketplace endpoint rather than a per-vertical one.
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
 * Reads every vertical's bookings for one user.
 *
 * Each vertical stores its bookings in its own table with its own columns, so
 * "My Bookings" previously showed only the home-services table — a user could
 * complete a clean, a rental, a repair and a porter job and see an empty list.
 * This maps them all onto one shape.
 */
@Injectable()
export class UnifiedBookingsRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  async findAllByUser(userId: string): Promise<UnifiedBooking[]> {
    const where = { userId };

    const [services, cleans, repairs, rentals, porters, rides, stays, adOrders] = await Promise.all(
      [
        this.db.booking.findMany({ where, include: { service: true } }),
        this.db.cleanBooking.findMany({ where, include: { items: true } }),
        this.db.repairBooking.findMany({ where, include: { items: true } }),
        this.db.rentalBooking.findMany({ where, include: { car: true, branch: true } }),
        this.db.porterBooking.findMany({ where, include: { vehicle: true } }),
        this.db.rideBooking.findMany({ where, include: { rideType: true } }),
        this.db.stayBooking.findMany({ where, include: { stay: true } }),
        // Scoped to the buyer: a seller's own listings appear in their Orders
        // tab, not in the list of things they have booked.
        this.db.adOrder.findMany({
          where: { buyerId: userId },
          include: { ad: { select: { icon: true } }, seller: { select: { name: true } } },
        }),
      ],
    );

    const rows: UnifiedBooking[] = [
      ...services.map((b) => ({
        id: b.id,
        vertical: 'services' as const,
        reference: b.reference,
        serviceName: b.service.name,
        serviceIcon: b.service.icon,
        providerName: b.service.providerName,
        status: b.status,
        scheduledAt: b.scheduledAt,
        addressText: b.addressText,
        total: Number(b.total),
        createdAt: b.createdAt,
      })),
      ...cleans.map((b) => ({
        id: b.id,
        vertical: 'elkclean' as const,
        reference: b.code,
        serviceName: summarise(b.items, 'Home Cleaning'),
        serviceIcon: '🧹',
        providerName: 'ELK Clean',
        status: b.status,
        scheduledAt: b.scheduledAt,
        addressText: b.addressText,
        total: b.totalAmount,
        createdAt: b.createdAt,
      })),
      ...repairs.map((b) => ({
        id: b.id,
        vertical: 'elkrep' as const,
        reference: b.code,
        serviceName: summarise(b.items, 'Repair Visit'),
        serviceIcon: '🔧',
        providerName: 'ELK Repair',
        status: b.status,
        scheduledAt: b.scheduledAt,
        addressText: b.addressText,
        total: b.totalAmount,
        createdAt: b.createdAt,
      })),
      ...rentals.map((b) => ({
        id: b.id,
        vertical: 'rentals' as const,
        reference: b.code,
        serviceName: b.car.name,
        serviceIcon: '🚗',
        providerName: 'ELK Rentals',
        status: b.status,
        scheduledAt: b.pickupAt,
        addressText: b.deliveryAddress ?? b.branch?.name ?? 'Branch pickup',
        total: b.totalAmount,
        createdAt: b.createdAt,
      })),
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
        providerName: b.driverName,
        status: b.status,
        scheduledAt: b.createdAt,
        addressText: `${b.pickupAddress} → ${b.dropAddress}`,
        total: Number(b.fare),
        createdAt: b.createdAt,
      })),
      ...stays.map((b) => ({
        id: b.id,
        vertical: 'elkstay' as const,
        reference: b.code,
        serviceName: b.stay.name,
        serviceIcon: '🏠',
        providerName: 'ELK Stay',
        status: b.status,
        scheduledAt: b.visitAt ?? b.moveInDate,
        addressText: b.stay.fullAddress,
        total: b.totalPaid ?? 0,
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

/** "Sofa Shampoo +2 more" — the cart summarised for a one-line list row. */
function summarise(items: { name: string }[], fallback: string): string {
  if (items.length === 0) return fallback;
  const [first] = items;
  return items.length === 1 ? first!.name : `${first!.name} +${items.length - 1} more`;
}
