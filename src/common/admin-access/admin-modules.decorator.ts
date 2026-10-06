import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { AdminModule } from '@prisma/client';
import type { Request } from 'express';

export const ADMIN_MODULES_KEY = 'adminModules';

/**
 * An ADMIN needs at least one of these modules for the route. Other roles are
 * left to @Roles. The admin's modules are then available through @AdminScope().
 */
export const AdminModules = (...modules: AdminModule[]) => SetMetadata(ADMIN_MODULES_KEY, modules);

/** The modules the calling admin holds, loaded by AdminModulesGuard. */
export const AdminScope = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminModule[] =>
    ctx.switchToHttp().getRequest<Request>().adminModules ?? [],
);
