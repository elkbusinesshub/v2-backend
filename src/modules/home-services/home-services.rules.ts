import { ServiceVertical } from '@prisma/client';

/**
 * The app tiles a service can sit under, per vertical. Fixed rather than free
 * text: the app draws an icon per tile, and a slug nobody has drawn would
 * show blank.
 */
export const SERVICE_CATEGORIES: Record<ServiceVertical, readonly string[]> = {
  [ServiceVertical.CLEANING]: ['cln', 'deep', 'tnk', 'sof', 'crp', 'kit', 'bth', 'lndr'],
  [ServiceVertical.REPAIR]: ['ac', 'plm', 'elc', 'cpt', 'pnt', 'gen'],
};

/** Most hours and professionals a single booking can ask for. */
export const MAX_HOURS = 12;
export const MAX_PROFESSIONALS = 4;

/** What a service costs to book, before any promo code. */
export interface ServicePrice {
  hourlyRate: number;
  extraProRate: number;
  materialsFee: number;
}

export interface Quote {
  /** hourlyRate × hours + extraProRate × hours × (professionals − 1) */
  base: number;
  materials: number;
  subtotal: number;
}

export function quote(
  price: ServicePrice,
  hours: number,
  professionals: number,
  withMaterials: boolean,
): Quote {
  const base = price.hourlyRate * hours + price.extraProRate * hours * (professionals - 1);
  const materials = withMaterials ? price.materialsFee : 0;
  return { base, materials, subtotal: base + materials };
}

export interface PromoRule {
  code: string;
  percent: number;
  /** Zero means no cap. */
  maxDiscount: number;
  minOrder: number;
  /** Last usable day, YYYY-MM-DD, inclusive. */
  validTill: string;
  active: boolean;
}

export type PromoResult =
  | { ok: true; discount: number; capped: boolean; message: string }
  | { ok: false; discount: 0; message: string };

/**
 * Whether [promo] applies to an order of [subtotal] on [today], and how much
 * it takes off. The messages are the customer's — they are shown at checkout
 * as they are.
 */
export function applyPromo(
  promo: PromoRule | null,
  typedCode: string,
  subtotal: number,
  today: string,
): PromoResult {
  const code = typedCode.trim().toUpperCase();
  if (!promo) return { ok: false, discount: 0, message: `${code} isn't a valid code.` };
  if (promo.validTill < today) {
    return { ok: false, discount: 0, message: `${code} has expired.` };
  }
  if (!promo.active) return { ok: false, discount: 0, message: `${code} can't be used right now.` };
  if (subtotal < promo.minOrder) {
    return {
      ok: false,
      discount: 0,
      message: `${code} needs a minimum order of ₹${promo.minOrder}. Add ₹${promo.minOrder - subtotal} more.`,
    };
  }
  const raw = Math.round((subtotal * promo.percent) / 100);
  const discount = promo.maxDiscount > 0 ? Math.min(raw, promo.maxDiscount) : raw;
  const capped = discount < raw;
  return {
    ok: true,
    discount,
    capped,
    message: `${code} applied. ${promo.percent}% off${capped ? `, capped at ₹${promo.maxDiscount}` : ''}.`,
  };
}

/** Today's date in India, YYYY-MM-DD — bookings and promo expiry are Indian calendar days. */
export function todayInIndia(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export interface AreaRule {
  id: string;
  pincode: string;
  radiusKm: number;
  lat: number | null;
  lng: number | null;
}

/** Great-circle distance in km. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number): number => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * The service area an address falls in: the nearest one whose radius covers
 * its pin, or failing that one whose pincode appears in the address text.
 * Null when ELK does not serve the address.
 */
export function matchArea<T extends AreaRule>(
  areas: T[],
  address: { text: string; lat: number | null; lng: number | null },
): T | null {
  if (address.lat !== null && address.lng !== null) {
    const { lat, lng } = address;
    const covering = areas
      .filter((a) => a.lat !== null && a.lng !== null)
      .map((a) => ({ area: a, km: distanceKm(lat, lng, a.lat!, a.lng!) }))
      .filter(({ area, km }) => km <= area.radiusKm)
      .sort((x, y) => x.km - y.km);
    if (covering[0]) return covering[0].area;
  }
  const pincodes: string[] = address.text.match(/\b\d{6}\b/g) ?? [];
  return areas.find((a) => pincodes.includes(a.pincode)) ?? null;
}
