import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserType, type AdminModule } from '@prisma/client';
import type { Request } from 'express';
import { ForbiddenResourceException } from '../errors/domain.exceptions';
import { AdminAccessService } from './admin-access.service';
import { ADMIN_MODULES_KEY } from './admin-modules.decorator';

/**
 * Global guard, after JwtAuthGuard and RolesGuard. On routes marked
 * @AdminModules(...), an ADMIN must hold one of the modules; their modules
 * are put on the request for @AdminScope().
 */
@Injectable()
export class AdminModulesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AdminAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<AdminModule[] | undefined>(
      ADMIN_MODULES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length || context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (request.user?.role !== UserType.ADMIN) return true;

    const modules = await this.access.modules(request.user.id);
    if (!required.some((m) => modules.includes(m))) {
      throw new ForbiddenResourceException('Your admin account does not cover this area');
    }
    request.adminModules = modules;
    return true;
  }
}
