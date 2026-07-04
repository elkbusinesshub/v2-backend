import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { ForbiddenResourceException, UnauthenticatedException } from '../errors/domain.exceptions';

/**
 * Global RBAC guard. Runs after JwtAuthGuard (registration order in
 * AuthModule). Routes without @Roles() are unaffected.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length || context.getType() !== 'http') {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<Request>();
    if (!user) {
      // @Roles on a @Public route is a programming error — fail closed
      throw new UnauthenticatedException();
    }
    if (!user.roles.some((role) => required.includes(role))) {
      throw new ForbiddenResourceException();
    }
    return true;
  }
}
