import { BookingStatus } from '@prisma/client';

/** Display timezone for chat timestamps and tracking step times. */
export const ORDERS_DISPLAY_TIMEZONE = 'Asia/Dubai';

/** Socket.IO namespace for realtime order chat. */
export const CHAT_NAMESPACE = '/chat';

/** Provider-side presence line on the chat header (static until real presence exists). */
export const CHAT_CONTACT_STATUS = '● Online · Service Provider';

type StepStatus = 'done' | 'active' | 'pending';

/**
 * The five fixed tracking steps and how each maps to a booking status. The
 * timeline is derived from `Booking.status` — there's no separate tracking
 * state machine yet:
 *   CONFIRMED → first two steps done, "On The Way" active
 *   COMPLETED → all done
 *   CANCELLED → surfaced via a distinct status label, steps frozen at booking
 */
export const TRACKING_STEP_NAMES = [
  'Booking Confirmed',
  'Provider Accepted',
  'On The Way',
  'In Progress',
  'Completed',
] as const;

export const TRACKING_STATUS_LABEL: Record<BookingStatus, string> = {
  [BookingStatus.CONFIRMED]: 'Arriving soon',
  [BookingStatus.COMPLETED]: 'Service completed',
  [BookingStatus.CANCELLED]: 'Booking cancelled',
};

/** Per-status step states, index-aligned with TRACKING_STEP_NAMES. */
export const TRACKING_STEP_STATES: Record<BookingStatus, StepStatus[]> = {
  [BookingStatus.CONFIRMED]: ['done', 'done', 'active', 'pending', 'pending'],
  [BookingStatus.COMPLETED]: ['done', 'done', 'done', 'done', 'done'],
  [BookingStatus.CANCELLED]: ['done', 'pending', 'pending', 'pending', 'pending'],
};
