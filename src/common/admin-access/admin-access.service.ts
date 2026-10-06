import { Injectable } from '@nestjs/common';
import { AdminModule, ServiceVertical, UserType } from '@prisma/client';
import type { AuthUser } from '@/common/types/auth.types';
import { AdminAccessRepository } from './admin-access.repository';

/** The ELK-run service vertical each module covers. */
const VERTICAL_OF: Partial<Record<AdminModule, ServiceVertical>> = {
  [AdminModule.CLEAN]: ServiceVertical.CLEANING,
  [AdminModule.REPAIR]: ServiceVertical.REPAIR,
};

/** Marketplace categories that are ELK Rental. */
export const RENTAL_CATEGORIES: readonly string[] = ['car_rental'];

export function verticalsOf(modules: readonly AdminModule[]): ServiceVertical[] {
  return modules.map((m) => VERTICAL_OF[m]).filter((v): v is ServiceVertical => !!v);
}

/**
 * Which modules an admin may use. Read from the database on each check, so a
 * change by the super admin applies at once rather than at the next token.
 */
@Injectable()
export class AdminAccessService {
  constructor(private readonly repo: AdminAccessRepository) {}

  modules(userId: string): Promise<AdminModule[]> {
    return this.repo.modules(userId);
  }

  /** True for an ADMIN holding [module]; false for everyone else. */
  async has(user: AuthUser, module: AdminModule): Promise<boolean> {
    return user.role === UserType.ADMIN && (await this.modules(user.id)).includes(module);
  }

  /** An admin acting on a marketplace listing in [categorySlug]. */
  async canModerate(user: AuthUser, categorySlug: string): Promise<boolean> {
    return RENTAL_CATEGORIES.includes(categorySlug) && this.has(user, AdminModule.RENTAL);
  }
}
