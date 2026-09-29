import { type Prisma, Role, UserType } from '@prisma/client';

const ROLE_VALUES = new Set<string>(Object.values(Role));

/** Narrows the JSON `roles` column (MySQL has no enum arrays) back to Role[]. */
export function toRoles(value: Prisma.JsonValue): Role[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((r): r is Role => typeof r === 'string' && ROLE_VALUES.has(r));
}

/**
 * The roles a user acts with. ADMIN comes only from `userType`, so an ADMIN
 * left in the `roles` JSON grants nothing.
 */
export function userRoles(user: { roles: Prisma.JsonValue; userType: UserType }): Role[] {
  const roles = toRoles(user.roles).filter((r) => r !== Role.ADMIN);
  return user.userType === UserType.ADMIN ? [...roles, Role.ADMIN] : roles;
}
