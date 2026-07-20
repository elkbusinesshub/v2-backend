/** Flat service fee on every porter delivery (AED). */
export const PORTER_SERVICE_FEE = 3.5;

/** UAE VAT applied on (fare + service fee). */
export const PORTER_VAT_RATE = 0.05;

/**
 * "Schedule for later" pickup windows (label + 24h start), as the booking
 * flow renders them. Wall-clock times in the operating region.
 */
export const PORTER_PICKUP_WINDOWS: readonly { label: string; start: string }[] = [
  { label: '9:00 – 10:00', start: '09:00' },
  { label: '11:00 – 12:00', start: '11:00' },
  { label: '2:00 – 3:00 pm', start: '14:00' },
  { label: '4:00 – 5:00 pm', start: '16:00' },
];

/** "Schedule for later" horizon (the app's date picker allows 30 days). */
export const PORTER_SCHEDULE_MAX_DAYS = 30;

/** Same fixed regional offset as the other verticals. */
export const PORTER_UTC_OFFSET = '+04:00';

/** Payment sheet options (all mock/internal charges until payments exist). */
export const PORTER_PAYMENT_METHODS = ['wallet', 'card', 'apple', 'cash'] as const;

/**
 * Static route estimate until the maps layer computes real distances —
 * mirrors the app's fixture (4.2 km / per-vehicle ETA).
 */
export const PORTER_DEFAULT_DISTANCE_KM = 4.2;

/** Legacy /porter/options route card (display fixture, matches dummy data). */
export const PORTER_DEFAULT_ROUTE = {
  pickupLabel: 'Pickup Location',
  pickupAddress: 'Dubai Marina, Block C',
  dropLabel: 'Drop Location',
  dropAddress: 'Downtown Dubai, Tower 4',
  packageType: 'Electronics',
  weight: '2.5 kg',
} as const;

/** Tracking id: ELK-####-AA, per the success screen. */
export const PORTER_CODE_MIN = 1000;
export const PORTER_CODE_SPAN = 9000;
export const PORTER_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
