import type { Prisma, RentalBranch, RentalCar, RentalExtra } from '@prisma/client';
import {
  CAR_CATEGORY_DISPLAY,
  CAR_CATEGORY_EMOJI,
  CAR_CATEGORY_ENUM_TO_ID,
} from './rentals.constants';

/**
 * Prisma entities → the exact JSON both frontend representations parse:
 * the legacy RentalCarModel.fromJson (type/icon/isBestDeal) and the newer
 * listing card (category/iconKey/fuel/rating/badge).
 */

export type RentalBookingFull = Prisma.RentalBookingGetPayload<{
  include: { car: true; branch: true; extras: true };
}>;

export function toCarJson(car: RentalCar): Record<string, unknown> {
  return {
    id: car.id,
    name: car.name,
    // legacy fields
    type: CAR_CATEGORY_DISPLAY[car.category],
    icon: CAR_CATEGORY_EMOJI[car.category],
    isBestDeal: car.badge === 'BEST DEAL',
    // current fields
    category: CAR_CATEGORY_ENUM_TO_ID[car.category],
    iconKey: car.iconKey,
    seats: car.seats,
    transmission: car.transmission,
    fuel: car.fuel,
    rating: Number(car.rating),
    pricePerDay: car.pricePerDay,
    badge: car.badge,
  };
}

export function toBranchJson(branch: RentalBranch): Record<string, unknown> {
  return {
    id: branch.id,
    slug: branch.slug,
    name: branch.name,
    address: branch.address,
    distance: branch.distanceLabel,
  };
}

export function toExtraJson(extra: RentalExtra): Record<string, unknown> {
  return {
    id: extra.id,
    key: extra.key,
    name: extra.name,
    description: extra.description,
    pricePerDay: extra.pricePerDay,
  };
}

export function toRentalBookingJson(booking: RentalBookingFull): Record<string, unknown> {
  return {
    id: booking.id,
    code: booking.code,
    status: booking.status.toLowerCase(),
    rentalType: booking.rentalType.toLowerCase(),
    car: toCarJson(booking.car),
    fulfilment: booking.fulfilment.toLowerCase(),
    branch: booking.branch ? toBranchJson(booking.branch) : null,
    deliveryAddress: booking.deliveryAddress,
    deliveryBuilding: booking.deliveryBuilding,
    deliveryNotes: booking.deliveryNotes,
    pickupAt: booking.pickupAt.toISOString(),
    returnAt: booking.returnAt.toISOString(),
    actualPickupAt: booking.actualPickupAt?.toISOString() ?? null,
    actualReturnAt: booking.actualReturnAt?.toISOString() ?? null,
    extras: booking.extras.map((e) => ({ name: e.name, pricePerDay: e.pricePerDay })),
    breakdown: {
      days: booking.days,
      dailyRate: booking.dailyRate,
      rentalTotal: booking.rentalTotal,
      deliveryFee: booking.deliveryFee,
      extrasTotal: booking.extrasTotal,
      subtotal: booking.subtotal,
      promoCode: booking.promoCode,
      promoDiscount: booking.promoDiscount,
      vatAmount: booking.vatAmount,
      lateFee: booking.lateFee,
      totalAmount: booking.totalAmount,
    },
    paymentMethod: booking.paymentMethod,
    paidAt: booking.paidAt?.toISOString() ?? null,
    refundedAt: booking.refundedAt?.toISOString() ?? null,
    createdAt: booking.createdAt.toISOString(),
  };
}
