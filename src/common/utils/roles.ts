import { type Prisma, Role } from '@prisma/client';

const ROLE_VALUES = new Set<string>(Object.values(Role));

/** Narrows the JSON `roles` column (MySQL has no enum arrays) back to Role[]. */
export function toRoles(value: Prisma.JsonValue): Role[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((r): r is Role => typeof r === 'string' && ROLE_VALUES.has(r));
}
