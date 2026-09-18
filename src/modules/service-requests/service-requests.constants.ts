import { ServiceRequestKind, ServiceRequestStatus } from '@prisma/client';

/**
 * Districts a cleaning partner can cover and a buyer can pick.
 *
 * A starter list — replace it with the districts ELK actually has partners
 * in. Slugs are stored on partners and requests, so rename a `name` freely
 * but never change a `slug` that is in use.
 */
export const SERVICE_DISTRICTS = [
  { slug: 'bengaluru_urban', name: 'Bengaluru Urban' },
  { slug: 'bengaluru_rural', name: 'Bengaluru Rural' },
  { slug: 'mysuru', name: 'Mysuru' },
  { slug: 'chennai', name: 'Chennai' },
  { slug: 'coimbatore', name: 'Coimbatore' },
  { slug: 'hyderabad', name: 'Hyderabad' },
  { slug: 'ernakulam', name: 'Ernakulam' },
  { slug: 'thiruvananthapuram', name: 'Thiruvananthapuram' },
  { slug: 'kozhikode', name: 'Kozhikode' },
  { slug: 'thrissur', name: 'Thrissur' },
] as const;

export const DISTRICT_SLUGS = SERVICE_DISTRICTS.map((d) => d.slug);

export const CLEANING_SERVICE_TYPES = [
  'HOME_CLEANING',
  'DEEP_CLEANING',
  'KITCHEN',
  'BATHROOM',
  'SOFA_CARPET',
  'WATER_TANK',
] as const;

export const VEHICLE_TYPES = [
  'BIKE',
  'SCOOTER',
  'HATCHBACK',
  'SEDAN',
  'SUV',
  'TEMPO_TRAVELLER',
] as const;

export const FULFILMENTS = ['DELIVERY', 'PICKUP'] as const;

export const OTP_LENGTH = 6;

/** Wrong codes allowed before the OTP locks and the buyer needs a new one. */
export const MAX_OTP_ATTEMPTS = 5;

/**
 * When the buyer's wallet is charged.
 *
 * Cleaning: when the OTP matches at the home, before the work starts.
 * Rental: when the partner taps Complete after the vehicle comes back — the
 * handover OTP only starts the rental. Change a value here to move it.
 */
export const CHARGE_AT: Record<ServiceRequestKind, 'OTP' | 'COMPLETE'> = {
  CLEANING: 'OTP',
  RENTAL: 'COMPLETE',
};

/**
 * Only admin-verified partners who are online receive requests. A stranger
 * is sent into someone's home, so an unverified profile does not qualify.
 */
export const REQUIRE_VERIFIED_PARTNERS = true;

/** A partner already booked within this many hours of a slot is busy. */
export const CLEANING_SLOT_HOURS = 2;

export const MAX_RENTAL_DAYS = 90;

/** Statuses in which a request still occupies the partner. */
export const OPEN_STATUSES: ServiceRequestStatus[] = [
  ServiceRequestStatus.PENDING,
  ServiceRequestStatus.ACCEPTED,
  ServiceRequestStatus.IN_PROGRESS,
];

export const REQUEST_NOTIFICATION_COLOR = 0xffe0f7f5;

export const WALLET_TXN_SERVICE_PAYMENT = { icon: '🧾', colorHex: 0xffe0f7f5 };
export const WALLET_TXN_SERVICE_EARNING = { icon: '💰', colorHex: 0xffd1fae5 };
