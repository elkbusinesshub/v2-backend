/**
 * Static route estimate until the maps layer computes real distances —
 * mirrors the app's fixed ETA pill ("18 min · 4.2 km" / "14 min · 8.2 km").
 * A single estimate applies to every ride type; only the fare differs.
 */
export const RIDE_DEFAULT_DISTANCE_KM = 8.2;
export const RIDE_DEFAULT_ETA_MINUTES = 14;

/** Legacy /rides/current-estimate payload (display fixture, matches dummy data). */
export const RIDE_DEFAULT_ESTIMATE = {
  pickup: 'Dubai Marina · Gate 3',
  drop: 'Downtown Dubai, Burj Khalifa',
} as const;

/** Payment sheet options (all mock/internal charges until payments exist). */
export const RIDE_PAYMENT_METHODS = ['cash', 'card', 'wallet', 'applepay'] as const;

/** Tracking code: ELK-####### (7-char alphanumeric), per the receipt screen. */
export const RIDE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const RIDE_CODE_LENGTH = 7;

/** Pickup OTP shown to the rider to hand to the driver at pickup. */
export const RIDE_OTP_LENGTH = 4;

/** Rating is a 1–5 star scale, tip is capped so it can't be abused as a side-channel charge. */
export const RIDE_MAX_TIP = 200;

/**
 * Mock driver pool — assigned pseudo-randomly at booking time. Plain
 * snapshot fields on the booking, not a relation: there's no real driver
 * module yet (mirrors `Service.providerName`, a seeded display value until
 * the provider module exists).
 */
export const RIDE_MOCK_DRIVERS: readonly { name: string; vehicleLabel: string; plate: string }[] = [
  { name: 'Farhan Ahmed', vehicleLabel: 'Toyota Corolla · White', plate: 'DXB · B 22417' },
  { name: 'Yusuf Khan', vehicleLabel: 'Toyota Corolla · White', plate: 'DXB 4471' },
  { name: 'Amir Hassan', vehicleLabel: 'Honda Civic · Silver', plate: 'DXB · C 88790' },
];
