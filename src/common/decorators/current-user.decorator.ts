import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { UnauthenticatedException } from '../errors/domain.exceptions';
import type { AuthUser } from '../types/auth.types';

/**
 * Injects the authenticated user into a handler parameter:
 *   me(@CurrentUser() user: AuthUser) { ... }
 * Throws if used on a route the auth guard did not populate (e.g. @Public).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    if (!request.user) {
      throw new UnauthenticatedException();
    }
    return request.user;
  },
);
