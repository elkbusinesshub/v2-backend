import type { Prisma, StayBookingStatus } from '@prisma/client';
import { CATEGORY_ENUM_TO_ID, STAY_DISPLAY_TIMEZONE } from './elkstay.constants';

/**
 * Maps Prisma entities to the exact JSON the Flutter models parse
 * (StayModel.fromJson / StayBookingModel.fromJson). All presentation
 * labels the app renders verbatim are computed here, server-side.
 */

export type StayWithAmenities = Prisma.StayGetPayload<{ include: { amenities: true } }>;
export type StayWithDetail = Prisma.StayGetPayload<{
  include: { amenities: true; roomOptions: true };
}>;
export type BookingWithStay = Prisma.StayBookingGetPayload<{ include: { stay: true } }>;

export function toStayJson(stay: StayWithAmenities): Record<string, unknown> {
  return {
    id: stay.id,
    name: stay.name,
    categoryType: CATEGORY_ENUM_TO_ID[stay.categoryType],
    badge: stay.badge,
    roomType: stay.roomType,
    location: stay.location,
    fullAddress: stay.fullAddress,
    distanceKm: Number(stay.distanceKm),
    pricePerMonth: stay.pricePerMonth,
    rating: Number(stay.rating),
    isVerified: stay.isVerified,
    amenities: [...stay.amenities]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((a) => ({ iconKey: a.iconKey, label: a.label })),
    description: stay.description,
    gradientStart: Number(stay.gradientStart),
    gradientEnd: Number(stay.gradientEnd),
  };
}

export function toStayDetailJson(
  stay: StayWithDetail,
  extras: { isSaved: boolean },
): Record<string, unknown> {
  return {
    ...toStayJson(stay),
    isSaved: extras.isSaved,
    roomOptions: [...stay.roomOptions]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        subtitle: r.subtitle,
        pricePerMonth: r.pricePerMonth,
      })),
  };
}

const STATUS_WIRE: Record<StayBookingStatus, string> = {
  CONFIRMED: 'confirmed',
  VISIT_BOOKED: 'visit_booked',
  PENDING: 'pending',
  COMPLETED: 'past',
  CANCELLED: 'cancelled', // never listed; kept total for exhaustiveness
};

export function toBookingJson(booking: BookingWithStay): Record<string, unknown> {
  const { stay } = booking;
  const isVisit = booking.type === 'VISIT';

  return {
    id: booking.id,
    code: booking.code,
    stayId: stay.id,
    stayName: stay.name,
    badge: stay.badge,
    roomType: stay.roomType,
    location: stay.location,
    status: STATUS_WIRE[booking.status],
    primaryDateLabel: isVisit ? 'Visit' : 'Move-in',
    primaryDate: isVisit
      ? formatVisitDateTime(booking.visitAt)
      : formatCalendarDate(booking.moveInDate),
    rentPerMonth: booking.rentPerMonth ?? stay.pricePerMonth,
    secondaryLabel: isVisit ? 'Deposit' : 'Next due',
    secondaryValue: isVisit ? '1 month' : formatShortDate(booking.nextDueDate),
    gradientStart: Number(stay.gradientStart),
    gradientEnd: Number(stay.gradientEnd),
  };
}

// ─── date labels (rendered verbatim by the app) ──────────────────────────────

/** "12 Jun 2026" — calendar dates are stored at UTC midnight. */
function formatCalendarDate(date: Date | null): string {
  if (!date) return '—';
  const parts = utcParts(date);
  return `${parts.day} ${parts.month} ${parts.year}`;
}

/** "01 Jul" */
function formatShortDate(date: Date | null): string {
  if (!date) return '—';
  const parts = utcParts(date);
  return `${parts.day} ${parts.month}`;
}

/** "10 Jun, 5 PM" (or "10 Jun, 5:30 PM"), in the display timezone. */
function formatVisitDateTime(date: Date | null): string {
  if (!date) return '—';
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: STAY_DISPLAY_TIMEZONE,
    day: '2-digit',
    month: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const minutes = p.minute === '00' ? '' : `:${p.minute}`;
  const period = (p.dayPeriod ?? '').toUpperCase().replace(/\./g, '');
  const month = MONTHS[Number(p.month) - 1] ?? '';
  return `${p.day} ${month}, ${p.hour}${minutes} ${period}`.trim();
}

// Fixed 3-letter months — Intl's en-GB "short" yields "Sept", the app uses "Sep"
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function utcParts(date: Date): { day: string; month: string; year: string } {
  return {
    day: String(date.getUTCDate()).padStart(2, '0'),
    month: MONTHS[date.getUTCMonth()] ?? '',
    year: String(date.getUTCFullYear()),
  };
}
