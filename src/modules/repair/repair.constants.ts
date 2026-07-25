/** Flat "Visit & inspection fee" added to every repair booking (AED). */
export const REPAIR_VISIT_FEE = 15;

/** Arrival-window start times offered by the scheduler (2-hour windows). */
export const REPAIR_TIME_SLOTS = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'] as const;

/** Bookable window: today through today + 5 (the app's 6-day strip). */
export const REPAIR_BOOKABLE_DAYS = 6;

/** "Free cancellation" cutoff before the arrival window. */
export const REPAIR_CANCEL_CUTOFF_HOURS = 2;

/** Slots are wall-clock times in the operating region (UAE). */
export const REPAIR_UTC_OFFSET = '+04:00';

/** Booking reference: ELK-#### (4-digit number), per the done screen. */
export const REPAIR_CODE_MIN = 1000;
export const REPAIR_CODE_SPAN = 9000;

/** Payment sheet options (all mock/internal charges until payments exist). */
export const REPAIR_PAYMENT_METHODS = ['card', 'apple', 'wallet'] as const;

/** Placeholder header location until the app sends the user's area. */
export const REPAIR_DEFAULT_LOCATION = 'Al Reem Island';

/** Cart guard rails. */
export const REPAIR_MAX_CART_LINES = 20;
export const REPAIR_MAX_LINE_QTY = 50;

/**
 * "What's included" is identical static copy for every repair job across
 * the app (not per-service data) — returned verbatim on the service detail
 * endpoint rather than modeled as a database column.
 */
export const REPAIR_INCLUDED = [
  'On-site inspection & diagnosis',
  'Labour by certified technician',
  'Standard parts & consumables',
  'Clean-up after the job',
  '30-day workmanship warranty',
];
