import { StayCategoryType } from '@prisma/client';

/** Fixed service fee charged on every stay booking (frontend: ₹499). */
export const STAY_SERVICE_FEE = 499;

/** Timezone used for user-facing date labels on booking cards. */
export const STAY_DISPLAY_TIMEZONE = 'Asia/Dubai';

/** Booking reference alphabet/length — success ticket shows ELK-XXXXX. */
export const BOOKING_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const BOOKING_CODE_LENGTH = 5;

/** Placeholder until the saved-addresses module supplies the user's area. */
export const STAY_DEFAULT_LOCATION = 'Koramangala, Bangalore';

/**
 * Wire ids used by the Flutter app (StayCategoryTypeX.id) ↔ Prisma enum.
 */
export const CATEGORY_ID_TO_ENUM: Record<string, StayCategoryType> = {
  pg_stay: StayCategoryType.PG_STAY,
  mens_hostel: StayCategoryType.MENS_HOSTEL,
  womens_hostel: StayCategoryType.WOMENS_HOSTEL,
  homestay: StayCategoryType.HOMESTAY,
};

export const CATEGORY_ENUM_TO_ID: Record<StayCategoryType, string> = {
  [StayCategoryType.PG_STAY]: 'pg_stay',
  [StayCategoryType.MENS_HOSTEL]: 'mens_hostel',
  [StayCategoryType.WOMENS_HOSTEL]: 'womens_hostel',
  [StayCategoryType.HOMESTAY]: 'homestay',
};

/**
 * Category card presentation (name/emoji/gradients) exactly as the app's
 * fixtures render them. Pure presentation → code constant, not a table;
 * `count` is computed live from the stays table.
 */
export const CATEGORY_PRESENTATION: Record<
  StayCategoryType,
  { name: string; emoji: string; gradientStart: number; gradientEnd: number }
> = {
  [StayCategoryType.PG_STAY]: {
    name: 'PG Stays',
    emoji: '🏠',
    gradientStart: 0xff1a5547,
    gradientEnd: 0xff0e3a30,
  },
  [StayCategoryType.MENS_HOSTEL]: {
    name: "Men's Hostel",
    emoji: '👤',
    gradientStart: 0xff2c6e5c,
    gradientEnd: 0xff184c40,
  },
  [StayCategoryType.WOMENS_HOSTEL]: {
    name: "Women's Hostel",
    emoji: '👤',
    gradientStart: 0xffc97d2a,
    gradientEnd: 0xffa85f16,
  },
  [StayCategoryType.HOMESTAY]: {
    name: 'Homestays',
    emoji: '🍽️',
    gradientStart: 0xff3a6b5e,
    gradientEnd: 0xff244c42,
  },
};

export const PAYMENT_METHODS = ['upi', 'card', 'wallet', 'bank'] as const;
export type StayPaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Redis cache keys owned by this module. */
export const CACHE_KEY_CATEGORY_COUNTS = 'elkstay:category-counts';
export const CATEGORY_COUNTS_TTL_SECONDS = 60;
