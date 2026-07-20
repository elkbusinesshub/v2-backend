import type { PorterAddon, PorterVehicle, Prisma } from '@prisma/client';

/**
 * Prisma entities → the exact JSON the app parses: the legacy
 * PorterVehicleModel.fromJson (id/emoji/name/capacity) plus the newer
 * vehicle cards (iconKey/etaMinutes/baseFare/badge). Decimal money is
 * narrowed to numbers at this boundary (Flutter casts `as num`).
 */

export type PorterBookingFull = Prisma.PorterBookingGetPayload<{
  include: { vehicle: true; addons: true };
}>;

export function toVehicleJson(vehicle: PorterVehicle): Record<string, unknown> {
  return {
    id: vehicle.slug,
    emoji: vehicle.emoji,
    name: vehicle.name,
    capacity: vehicle.capacityLabel,
    iconKey: vehicle.iconKey,
    etaMinutes: vehicle.etaMinutes,
    baseFare: Number(vehicle.baseFare),
    badge: vehicle.badge,
  };
}

export function toAddonJson(addon: PorterAddon): Record<string, unknown> {
  return {
    id: addon.key,
    label: addon.label,
    price: Number(addon.price),
  };
}

export function toPorterBookingJson(booking: PorterBookingFull): Record<string, unknown> {
  return {
    id: booking.id,
    code: booking.code,
    status: booking.status.toLowerCase(),
    vehicle: toVehicleJson(booking.vehicle),
    pickupAddress: booking.pickupAddress,
    dropAddress: booking.dropAddress,
    packageType: booking.packageType,
    weightLabel: booking.weightLabel,
    scheduledAt: booking.scheduledAt?.toISOString() ?? null,
    pickupWindow: booking.pickupWindow,
    distanceKm: Number(booking.distanceKm),
    etaMinutes: booking.etaMinutes,
    addons: booking.addons.map((a) => ({ label: a.label, price: Number(a.price) })),
    breakdown: {
      baseFare: Number(booking.baseFare),
      addonsTotal: Number(booking.addonsTotal),
      serviceFee: Number(booking.serviceFee),
      vatAmount: Number(booking.vatAmount),
      totalAmount: Number(booking.totalAmount),
    },
    paymentMethod: booking.paymentMethod,
    paidAt: booking.paidAt?.toISOString() ?? null,
    pickedUpAt: booking.pickedUpAt?.toISOString() ?? null,
    deliveredAt: booking.deliveredAt?.toISOString() ?? null,
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    createdAt: booking.createdAt.toISOString(),
  };
}
