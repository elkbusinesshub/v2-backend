import { RentalCarCategory, RentalType } from '@prisma/client';

/** Flat delivery fee when the car is delivered to the customer (AED). */
export const RENTAL_DELIVERY_FEE = 25;

/** UAE VAT applied on (subtotal − discount). */
export const RENTAL_VAT_RATE = 0.05;

/**
 * Daily-rate multiplier per rental type — the booking flow's discount for
 * longer commitments (rental_booking_flow.dart line 38).
 */
export const RENTAL_RATE_MULTIPLIER: Record<RentalType, number> = {
  [RentalType.DAILY]: 1.0,
  [RentalType.WEEKLY]: 0.85,
  [RentalType.MONTHLY]: 0.7,
};

/** Booking reference: ELK-##### (5-digit number), per the success ticket. */
export const RENTAL_CODE_MIN = 10000;
export const RENTAL_CODE_SPAN = 90000;

/** Wire ids used by the app's filter chips ↔ Prisma enum. */
export const CAR_CATEGORY_ID_TO_ENUM: Record<string, RentalCarCategory> = {
  sedan: RentalCarCategory.SEDAN,
  suv: RentalCarCategory.SUV,
  luxury: RentalCarCategory.LUXURY,
};

export const CAR_CATEGORY_ENUM_TO_ID: Record<RentalCarCategory, string> = {
  [RentalCarCategory.SEDAN]: 'sedan',
  [RentalCarCategory.SUV]: 'suv',
  [RentalCarCategory.LUXURY]: 'luxury',
};

/** Display names as the old fixtures render them ("type" field). */
export const CAR_CATEGORY_DISPLAY: Record<RentalCarCategory, string> = {
  [RentalCarCategory.SEDAN]: 'Sedan',
  [RentalCarCategory.SUV]: 'SUV',
  [RentalCarCategory.LUXURY]: 'Luxury',
};

/** Emoji per category — the legacy RentalCarModel renders `icon`. */
export const CAR_CATEGORY_EMOJI: Record<RentalCarCategory, string> = {
  [RentalCarCategory.SEDAN]: '🚗',
  [RentalCarCategory.SUV]: '🚙',
  [RentalCarCategory.LUXURY]: '🚘',
};

export const RENTAL_TYPE_IDS = ['daily', 'weekly', 'monthly'] as const;

export const RENTAL_TYPE_ID_TO_ENUM: Record<string, RentalType> = {
  daily: RentalType.DAILY,
  weekly: RentalType.WEEKLY,
  monthly: RentalType.MONTHLY,
};

export const RENTAL_PAYMENT_METHODS = ['card', 'wallet', 'cash'] as const;
