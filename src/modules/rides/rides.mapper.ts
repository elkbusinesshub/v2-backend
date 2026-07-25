import type { RideBooking, RideType } from '@prisma/client';

/**
 * Prisma entities → the exact JSON the app parses: the legacy
 * RideTypeModel.fromJson (id/emoji/name/price) plus the newer ride cards
 * (iconKey/seats/etaMinutes/badge). Decimal money is narrowed to numbers at
 * this boundary (Flutter casts `as num`).
 */

export function toRideTypeJson(rideType: RideType): Record<string, unknown> {
  return {
    id: rideType.slug,
    emoji: rideType.emoji,
    name: rideType.name,
    price: Number(rideType.baseFare),
    iconKey: rideType.iconKey,
    seats: rideType.seats,
    etaMinutes: rideType.etaMinutes,
    cancellationFee: Number(rideType.cancellationFee),
    badge: rideType.badge,
  };
}

export function toRideBookingJson(
  booking: RideBooking & { rideType: RideType },
): Record<string, unknown> {
  return {
    id: booking.id,
    code: booking.code,
    status: booking.status.toLowerCase(),
    rideType: toRideTypeJson(booking.rideType),
    pickupAddress: booking.pickupAddress,
    dropAddress: booking.dropAddress,
    distanceKm: Number(booking.distanceKm),
    etaMinutes: booking.etaMinutes,
    driver: {
      name: booking.driverName,
      vehicle: booking.vehicleLabel,
      plateNumber: booking.plateNumber,
    },
    // the OTP is only meaningful before the trip starts — hidden afterwards
    otpCode: booking.startedAt ? null : booking.otpCode,
    breakdown: {
      baseFare: Number(booking.fare),
      totalAmount: Number(booking.fare),
    },
    cancellationFee: Number(booking.cancellationFee),
    tipAmount: Number(booking.tipAmount),
    ratingStars: booking.ratingStars,
    paymentMethod: booking.paymentMethod,
    paidAt: booking.paidAt?.toISOString() ?? null,
    startedAt: booking.startedAt?.toISOString() ?? null,
    completedAt: booking.completedAt?.toISOString() ?? null,
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    createdAt: booking.createdAt.toISOString(),
  };
}
