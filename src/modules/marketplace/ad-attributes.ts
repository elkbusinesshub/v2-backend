import { type ErrorDetail, ValidationFailedException } from '@/common/errors/domain.exceptions';

/**
 * Per-category detail on a listing, stored in `Ad.attributes`.
 *
 * A cleaning ad and a car-rental ad describe themselves with different words —
 * one has a duration, the other has a gearbox. Rather than a column per field
 * (wide, almost entirely null) or a table per category (what this model is
 * replacing), the extras live in one JSON column and are validated here.
 *
 * This file is the only thing standing between a client and that column, so it
 * validates rather than trusts: unknown keys are rejected instead of stored,
 * and the value returned is rebuilt from known keys only. `class-validator`
 * cannot express "shape depends on the value of another field" without
 * polymorphic DTO gymnastics, so the check is written out plainly.
 */

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * A validated attribute bag. Typed as JSON rather than `unknown` so it can be
 * handed straight to Prisma's JSON column input without a cast at the callsite.
 */
export type AdAttributes = { [key: string]: JsonValue };

type FieldSpec =
  | { kind: 'string'; maxLength: number; oneOf?: readonly string[] }
  | { kind: 'int'; min: number; max: number }
  | { kind: 'boolean' }
  | { kind: 'stringList'; maxItems: number; maxLength: number };

/**
 * Categories absent from this map take no attributes at all.
 *
 * Taxi and porter are deliberately absent: they are dispatch products still
 * served by their own modules, and an ad in those categories carries nothing
 * extra. Every field is optional — a seller fills in what they know.
 */
/**
 * The tile a listing sits under on its vertical's home grid.
 *
 * A fixed set rather than free text: the grid renders a named icon per tile,
 * and a slug nobody has drawn would appear blank. Tiles with no listings are
 * simply not shown, so the grid always reflects what sellers actually offer.
 */
const CLEANING_SUB_CATEGORIES = [
  'cln', // Home Cleaning
  'deep', // Deep Cleaning
  'tnk', // Water Tank
  'sof', // Sofa & Upholstery
  'crp', // Carpet & Rug
  'kit', // Kitchen Clean
  'bth', // Bathroom Clean
  'lndr', // Laundry & Iron
] as const;

const REPAIR_SUB_CATEGORIES = [
  'ac', // AC & Cooling
  'plm', // Plumbing
  'elc', // Electrical
  'cpt', // Carpentry
  'pnt', // Painting
  'gen', // General
] as const;

const RENTAL_SUB_CATEGORIES = ['SEDAN', 'SUV', 'LUXURY'] as const;

const ATTRIBUTE_SCHEMA: Record<string, Record<string, FieldSpec>> = {
  cleaning: {
    subCategory: { kind: 'string', maxLength: 20, oneOf: CLEANING_SUB_CATEGORIES },
    durationLabel: { kind: 'string', maxLength: 40 },
    includes: { kind: 'stringList', maxItems: 12, maxLength: 80 },
  },
  repairing: {
    subCategory: { kind: 'string', maxLength: 20, oneOf: REPAIR_SUB_CATEGORIES },
    durationLabel: { kind: 'string', maxLength: 40 },
    warrantyLabel: { kind: 'string', maxLength: 40 },
  },
  car_rental: {
    subCategory: { kind: 'string', maxLength: 20, oneOf: RENTAL_SUB_CATEGORIES },
    seats: { kind: 'int', min: 1, max: 60 },
    transmission: { kind: 'string', maxLength: 20, oneOf: ['MANUAL', 'AUTOMATIC'] },
    fuel: { kind: 'string', maxLength: 20, oneOf: ['PETROL', 'DIESEL', 'ELECTRIC', 'HYBRID'] },
  },
  elkstay: {
    roomType: { kind: 'string', maxLength: 40 },
    stayType: {
      kind: 'string',
      maxLength: 20,
      oneOf: ['PG', 'MENS_HOSTEL', 'WOMENS_HOSTEL', 'HOMESTAY'],
    },
    // Rent lives in `Ad.price`; this is the one-off deposit on top of it.
    depositAmount: { kind: 'int', min: 0, max: 10_000_000 },
    furnished: { kind: 'boolean' },
  },
};

/** The categories that accept attributes — for error messages and tests. */
export const CATEGORIES_WITH_ATTRIBUTES = Object.keys(ATTRIBUTE_SCHEMA);

/**
 * Validates a listing's `attributes` against its category.
 *
 * Returns the value to store: a new object holding only recognised keys, or
 * `null` when there is nothing to store — so `{}` and "not supplied" persist
 * identically rather than leaving an empty object behind.
 *
 * @throws ValidationFailedException listing every problem at once, so a seller
 * fixing a form is not told about one bad field at a time.
 */
export function validateAdAttributes(categorySlug: string, raw: unknown): AdAttributes | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationFailedException([
      { field: 'attributes', message: 'attributes must be an object' },
    ]);
  }

  const schema = ATTRIBUTE_SCHEMA[categorySlug];
  const supplied = raw as Record<string, unknown>;

  if (!schema) {
    // Silently dropping these would let a client believe details were saved.
    if (Object.keys(supplied).length > 0) {
      throw new ValidationFailedException([
        {
          field: 'attributes',
          message: `the ${categorySlug} category takes no extra details`,
        },
      ]);
    }
    return null;
  }

  const errors: ErrorDetail[] = [];
  const clean: AdAttributes = {};

  for (const [key, value] of Object.entries(supplied)) {
    const spec = schema[key];
    if (!spec) {
      errors.push({
        field: `attributes.${key}`,
        message: `unknown detail for ${categorySlug}; expected one of ${Object.keys(schema).join(', ')}`,
      });
      continue;
    }
    // An explicit null is how a seller clears a field they had filled in.
    if (value === null || value === undefined) {
      continue;
    }
    const problem = check(spec, value);
    if (problem) {
      errors.push({ field: `attributes.${key}`, message: problem });
      continue;
    }
    // `check` has just proved this is text, a whole number, a boolean or a
    // list of text — all valid JSON, which the compiler cannot see for itself.
    clean[key] = value as JsonValue;
  }

  if (errors.length > 0) {
    throw new ValidationFailedException(errors);
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

/** The reason `value` fails `spec`, or null when it passes. */
function check(spec: FieldSpec, value: unknown): string | null {
  switch (spec.kind) {
    case 'string': {
      if (typeof value !== 'string') return 'must be text';
      if (value.length > spec.maxLength) return `must be at most ${spec.maxLength} characters`;
      if (spec.oneOf && !spec.oneOf.includes(value)) {
        return `must be one of ${spec.oneOf.join(', ')}`;
      }
      return null;
    }
    case 'int': {
      if (typeof value !== 'number' || !Number.isInteger(value)) return 'must be a whole number';
      if (value < spec.min || value > spec.max) {
        return `must be between ${spec.min} and ${spec.max}`;
      }
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be true or false';
    case 'stringList': {
      if (!Array.isArray(value)) return 'must be a list';
      if (value.length > spec.maxItems) return `must have at most ${spec.maxItems} entries`;
      const bad = value.some((v) => typeof v !== 'string' || v.length > spec.maxLength);
      return bad ? `each entry must be text of at most ${spec.maxLength} characters` : null;
    }
  }
}
