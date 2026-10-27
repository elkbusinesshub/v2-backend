import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { UserType, type AdminModule } from '@prisma/client';
import {
  DomainException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import { paginationMeta, type PaginationMeta } from '@/common/http/pagination';
import { toE164 } from './admin-catalog.service';
import type {
  AdminStatsDto,
  AdminUserDto,
  AdminUsersQueryDto,
  CreateStaffDto,
  UpdateStaffDto,
} from './admin.dto';
import { AdminUsersRepository, type UserRow } from './admin-users.repository';

/**
 * The super admin's Users tab: everyone with an app account, and the staff
 * accounts the super admin creates.
 *
 * A role is fixed for life. Customers sign themselves up and stay customers;
 * admins and super admins are created here and only ever run ELK — they
 * cannot book, buy or sell. So there is no role change, only staff details:
 * name, number, email and an admin's modules.
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

  async createStaff(dto: CreateStaffDto, superAdminId: string): Promise<AdminUserDto> {
    const modules = this.modulesFor(dto.role, dto.modules ?? []);
    const phone = toE164(dto.phone);
    const email = dto.email?.trim().toLowerCase() || null;
    await this.assertFree(phone, email);

    const created = await this.repo.createStaff({
      role: dto.role,
      name: dto.name.trim(),
      phone,
      email,
      modules,
    });
    this.logger.log(`staff created: ${dto.role}[${modules.join()}] ${phone} by ${superAdminId}`);
    return this.userJson(created);
  }

  async updateStaff(id: string, dto: UpdateStaffDto, superAdminId: string): Promise<AdminUserDto> {
    const user = await this.repo.user(id);
    if (!user) throw new ResourceNotFoundException('User');
    if (user.userType === UserType.USER) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'CUSTOMER_ACCOUNT',
        'Customer accounts can’t be edited here',
      );
    }
    const modules =
      dto.modules === undefined ? undefined : this.modulesFor(user.userType, dto.modules);
    if (modules && user.userType !== UserType.ADMIN) {
      throw new ValidationFailedException([
        { field: 'modules', message: 'Only an admin runs modules' },
      ]);
    }
    const phone = dto.phone === undefined ? undefined : toE164(dto.phone);
    const email = dto.email === undefined ? undefined : dto.email.trim().toLowerCase() || null;
    await this.assertFree(phone, email, id);

    const updated = await this.repo.updateStaff(
      id,
      {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(email !== undefined ? { email } : {}),
      },
      modules,
    );
    this.logger.log(`staff details changed: user=${id} by ${superAdminId}`);
    return this.userJson(updated);
  }

  /** An ADMIN needs at least one module; a SUPER_ADMIN holds none. */
  private modulesFor(role: UserType, modules: AdminModule[]): AdminModule[] {
    if (role !== UserType.ADMIN) return [];
    if (modules.length === 0) {
      throw new ValidationFailedException([
        { field: 'modules', message: 'Choose at least one module for an admin' },
      ]);
    }
    return [...modules].sort();
  }

  /**
   * A number or email can belong to one account. One already used by a
   * customer stays theirs: a customer account never becomes staff.
   */
  private async assertFree(
    phone: string | undefined,
    email: string | null | undefined,
    exceptId?: string,
  ): Promise<void> {
    if (phone && (await this.repo.taken('phone', phone, exceptId))) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'PHONE_IN_USE',
        'This number already has an ELK account. Use another number.',
      );
    }
    if (email && (await this.repo.taken('email', email, exceptId))) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'EMAIL_IN_USE',
        'This email already belongs to an ELK account.',
      );
    }
  }

  private userJson(u: UserRow): AdminUserDto {
    return {
      id: u.id,
      name: u.name,
      phone: u.phone,
      email: u.email,
      role: u.userType,
      modules: u.adminModules.map((m) => m.module),
      joinedAt: u.createdAt.toISOString(),
    };
  }
}
