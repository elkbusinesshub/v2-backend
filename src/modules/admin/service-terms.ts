import type { HomeService, ServiceVertical } from '@prisma/client';

/** The fields whose change needs the super admin's approval. */
export const PRICE_FIELDS = ['minHours', 'hourlyRate', 'extraProRate', 'materialsFee'] as const;
export type PriceField = (typeof PRICE_FIELDS)[number];
export type ServicePrice = Record<PriceField, number>;

/** What the super admin compares: a service's name, tile and price. */
export type ServiceTerms = ServicePrice & {
  name: string;
  vertical: ServiceVertical;
  category: string;
};

export function termsOf(s: HomeService): ServiceTerms {
  return {
    name: s.name,
    vertical: s.vertical,
    category: s.category,
    minHours: s.minHours,
    hourlyRate: Number(s.hourlyRate),
    extraProRate: Number(s.extraProRate),
    materialsFee: Number(s.materialsFee),
  };
}

export function priceOf(t: ServicePrice): ServicePrice {
  return {
    minHours: t.minHours,
    hourlyRate: t.hourlyRate,
    extraProRate: t.extraProRate,
    materialsFee: t.materialsFee,
  };
}

export function samePrice(a: ServicePrice, b: ServicePrice): boolean {
  return PRICE_FIELDS.every((f) => a[f] === b[f]);
}

/** "From" in the app: the hourly rate for the minimum hours. */
export function startingPrice(t: ServicePrice): number {
  return t.hourlyRate * t.minHours;
}
