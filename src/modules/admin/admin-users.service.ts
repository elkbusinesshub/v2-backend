import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { UserType, type AdminModule } from '@prisma/client';
import {
  DomainException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import { paginationMeta, type PaginationMeta } from '@/common/http/pagination';
import type { AdminStatsDto, AdminUserDto, AdminUsersQueryDto } from './admin.dto';
import { AdminUsersRepository, type UserRow } from './admin-users.repository';

/**
 * The super admin's Users tab: everyone with an app account, and their role.
 * A role change reaches the user's access token at its next refresh, within
 * the access token's lifetime.
 */
@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(private readonly repo: AdminUsersRepository) {}

  async list(query: AdminUsersQueryDto): Promise<{ items: AdminUserDto[]; meta: PaginationMeta }> {
    const [rows, total] = await this.repo.page(query.search, query.skip, query.limit);
    return { items: rows.map((u) => this.userJson(u)), meta: paginationMeta(query, total) };
  }

  async stats(): Promise<AdminStatsDto> {
    const [customers, admins, superAdmins, active, paused, draft, cleaning, repair] =
      await this.repo.stats();
    return {
      users: { customers, admins, superAdmins, total: customers + admins + superAdmins },
      listings: { active, paused, draft, total: active + paused + draft },
      providerListings: { cleaning, repair, total: cleaning + repair },
    };
  }

  /**
   * Changes the role, and for an ADMIN which modules they run (at least one).
   * Changing an admin's modules alone is the same call with role ADMIN.
   */
  async setRole(
    id: string,
    role: UserType,
    superAdminId: string,
    modules: AdminModule[] = [],
  ): Promise<AdminUserDto> {
    if (id === superAdminId) {
      throw new DomainException(HttpStatus.CONFLICT, 'OWN_ROLE', 'You cannot change your own role');
    }
    const isAdmin = role === UserType.ADMIN;
    if (isAdmin && modules.length === 0) {
      throw new ValidationFailedException([
        { field: 'modules', message: 'Choose at least one module for an admin' },
      ]);
    }
    const wanted = isAdmin ? [...modules].sort() : [];

    const user = await this.repo.user(id);
    if (!user) throw new ResourceNotFoundException('User');
    const held = user.adminModules.map((m) => m.module);
    if (user.userType === role && held.join() === wanted.join()) return this.userJson(user);

    const updated = await this.repo.setAccess(id, role, wanted);
    this.logger.log(
      `access changed: user=${id} ${user.userType}[${held.join()}] -> ${role}[${wanted.join()}] by ${superAdminId}`,
    );
    return this.userJson(updated);
  }

  private userJson(u: UserRow): AdminUserDto {
    return {
      id: u.id,
      name: u.name,
      phone: u.phone,
      role: u.userType,
      modules: u.adminModules.map((m) => m.module),
      joinedAt: u.createdAt.toISOString(),
    };
  }
}
