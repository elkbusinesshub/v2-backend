/** Flat "Eco supplies & setup" fee added to every clean (AED). */
export const CLEAN_SUPPLY_FEE = 10;

/** Arrival-window start times offered by the scheduler (2-hour windows). */
export const CLEAN_TIME_SLOTS = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'] as const;

/** Bookable window: today through today + 5 (the app's 6-day strip). */
export const CLEAN_BOOKABLE_DAYS = 6;

/** "Free cancellation up to 2h before" (review screen promise). */
export const CLEAN_CANCEL_CUTOFF_HOURS = 2;

/**
 * Slots are wall-clock times in the operating region (UAE). Fixed offset
 * until real crew scheduling brings proper timezone handling.
 */
export const CLEAN_UTC_OFFSET = '+04:00';

/** Booking reference: ELC-#### (4-digit number), per the done screen. */
export const CLEAN_CODE_MIN = 1000;
export const CLEAN_CODE_SPAN = 9000;

/** Payment sheet options (all mock/internal charges until payments exist). */
export const CLEAN_PAYMENT_METHODS = ['card', 'apple', 'wallet'] as const;

/** Placeholder header location until the app sends the user's area. */
export const CLEAN_DEFAULT_LOCATION = 'Al Reem Island';

/** Cart guard rails. */
export const CLEAN_MAX_CART_LINES = 20;
export const CLEAN_MAX_LINE_QTY = 50;
