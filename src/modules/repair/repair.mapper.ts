import type { Prisma, RepairCategory, RepairOffer, RepairService } from '@prisma/client';
import { REPAIR_INCLUDED } from './repair.constants';

/**
 * Prisma entities → the JSON shapes the app's elkrep screens render
 * (mirrors RepairCategory/RepairService in elkrep_data.dart field-for-field;
 * icons stay client-side asset keys).
 */

export type RepairBookingFull = Prisma.RepairBookingGetPayload<{
  include: { items: true };
}>;

export function toCategoryJson(
  category: RepairCategory,
  extra?: { serviceCount?: number },
): Record<string, unknown> {
  return {
    id: category.slug,
    code: category.code,
    label: category.label,
    blurb: category.blurb,
    iconKey: category.iconKey,
    ...(extra?.serviceCount !== undefined ? { serviceCount: extra.serviceCount } : {}),
  };
}

export function toServiceJson(service: RepairService): Record<string, unknown> {
  return {
    id: service.id,
    code: service.code,
    name: service.name,
    description: service.description,
    price: service.price,
    duration: service.durationLabel,
    tag: service.tag,
    included: REPAIR_INCLUDED,
    isActive: service.isActive,
  };
}

export function toOfferJson(offer: RepairOffer): Record<string, unknown> {
  return {
    id: offer.id,
    title: offer.title,
    discount: offer.discountLabel,
    code: offer.promoCode,
    time: offer.timeLabel,
    unit: offer.timeUnit,
    category: offer.categoryLabel,
    iconKey: offer.iconKey,
  };
}

export function toRepairBookingJson(booking: RepairBookingFull): Record<string, unknown> {
  return {
    id: booking.id,
    code: booking.code,
    status: booking.status.toLowerCase(),
    scheduledDate: booking.scheduledDate.toISOString().slice(0, 10),
    timeSlot: booking.timeSlot,
    scheduledAt: booking.scheduledAt.toISOString(),
    address: { label: booking.addressLabel, line: booking.addressText },
    items: booking.items.map((i) => ({
      serviceId: i.serviceId,
      name: i.name,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
    })),
    breakdown: {
      subtotal: booking.subtotal,
      visitFee: booking.visitFee,
      promoCode: booking.promoCode,
      discountAmount: booking.discountAmount,
      totalAmount: booking.totalAmount,
    },
    paymentMethod: booking.paymentMethod,
    paidAt: booking.paidAt?.toISOString() ?? null,
    cancelledAt: booking.cancelledAt?.toISOString() ?? null,
    createdAt: booking.createdAt.toISOString(),
  };
}
