import { SetMetadata } from '@nestjs/common';
import { UserType } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Restricts a route to users whose role is one of the given ones. */
export const Roles = (...roles: UserType[]) => SetMetadata(ROLES_KEY, roles);
