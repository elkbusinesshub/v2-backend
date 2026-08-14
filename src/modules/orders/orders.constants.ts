import { AdOrderStatus } from '@prisma/client';

/** Display timezone for chat timestamps and tracking step times. */
export const ORDERS_DISPLAY_TIMEZONE = 'Asia/Kolkata';

/** Socket.IO namespace for realtime order chat. */
export const CHAT_NAMESPACE = '/chat';

/** Provider-side presence line on the chat header (static until real presence exists). */
export const CHAT_CONTACT_STATUS = '● Online · Service Provider';

type StepStatus = 'done' | 'active' | 'pending';

/**
 * The tracking timeline for an order placed against a listing.
 *
 * Four steps: an ad order has no dispatch, so there is no moment at which
 * someone is "on the way". Its milestones are the three timestamps the row
 * actually carries — placed, accepted, completed — plus the one it is
 * waiting on.
 */
export const AD_ORDER_STEP_NAMES = [
  'Order Placed',
  'Seller Accepted',
  'Work In Progress',
  'Completed',
] as const;

export const AD_ORDER_STATUS_LABEL: Record<AdOrderStatus, string> = {
  [AdOrderStatus.NEW]: 'Waiting for the seller',
  [AdOrderStatus.IN_PROGRESS]: 'Work under way',
  [AdOrderStatus.COMPLETED]: 'Completed',
  [AdOrderStatus.CANCELLED]: 'Order cancelled',
};

/** Per-status step states, index-aligned with AD_ORDER_STEP_NAMES. */
export const AD_ORDER_STEP_STATES: Record<AdOrderStatus, StepStatus[]> = {
  [AdOrderStatus.NEW]: ['done', 'active', 'pending', 'pending'],
  [AdOrderStatus.IN_PROGRESS]: ['done', 'done', 'active', 'pending'],
  [AdOrderStatus.COMPLETED]: ['done', 'done', 'done', 'done'],
  // Frozen where it stopped; the status label is what says it was cancelled,
  // rather than a step pretending to be complete.
  [AdOrderStatus.CANCELLED]: ['done', 'pending', 'pending', 'pending'],
};
