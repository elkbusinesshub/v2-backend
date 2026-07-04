import { Inject, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

@Injectable()
export class UsersRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  /** findFirst (not findUnique) so the soft-delete filter applies. */
  async findById(id: string): Promise<User | null> {
    return this.db.user.findFirst({ where: { id } });
  }
}
