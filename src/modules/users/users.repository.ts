import { Inject, Injectable } from '@nestjs/common';
import { Role, type User } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

@Injectable()
export class UsersRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  /** findFirst (not findUnique) so the soft-delete filter applies. */
  async findById(id: string): Promise<User | null> {
    return this.db.user.findFirst({ where: { id } });
  }

  async findByPhone(phone: string): Promise<User | null> {
    return this.db.user.findFirst({ where: { phone } });
  }

  /** Creates a bare user for a first-time phone/OTP login — no name collected yet. */
  async createByPhone(phone: string): Promise<User> {
    return this.db.user.create({ data: { phone, roles: [Role.USER] } });
  }

  async updateProfile(
    id: string,
    data: { name?: string; email?: string; language?: string },
  ): Promise<User> {
    return this.db.user.update({ where: { id }, data });
  }
}
