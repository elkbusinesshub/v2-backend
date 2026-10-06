import { Inject, Injectable } from '@nestjs/common';
import { UserType, type AdminModule, type Prisma, type User } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import type { ExtendedPrismaClient } from '@/database/prisma.extension';

const userSelect = {
  id: true,
  name: true,
  phone: true,
  userType: true,
  createdAt: true,
  adminModules: { select: { module: true }, orderBy: { module: 'asc' } },
} satisfies Prisma.UserSelect;

export type UserRow = Pick<User, 'id' | 'name' | 'phone' | 'userType' | 'createdAt'> & {
  adminModules: { module: AdminModule }[];
};

/** The super admin's Users tab: app accounts and their role. */
@Injectable()
export class AdminUsersRepository {
  constructor(@Inject(PRISMA) private readonly db: ExtendedPrismaClient) {}

  /** One page of app users, newest first, matching [search] by name or phone. */
  async page(search: string | undefined, skip: number, take: number): Promise<[UserRow[], number]> {
    const where: Prisma.UserWhereInput = { deletedAt: null };
    const q = search?.trim();
    if (q) {
      const digits = q.replace(/\D/g, '');
      where.OR = [{ name: { contains: q } }, ...(digits ? [{ phone: { contains: digits } }] : [])];
    }
    return this.db.$transaction([
      this.db.user.findMany({
        where,
        select: userSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.db.user.count({ where }),
    ]);
  }
  async user(id: string): Promise<(UserRow & { professional: { id: string } | null }) | null> {
    return this.db.user.findFirst({
      where: { id, deletedAt: null },
      select: { ...userSelect, professional: { select: { id: true } } },
    });
  }
  /** Sets the role and, for an ADMIN, exactly [modules]; any other role holds none. */
  async setAccess(id: string, role: UserType, modules: AdminModule[]): Promise<UserRow> {
    return this.db.$transaction(async (tx) => {
      await tx.adminModuleAccess.deleteMany({ where: { userId: id } });
      if (role === UserType.ADMIN) {
        await tx.adminModuleAccess.createMany({
          data: modules.map((module) => ({ userId: id, module })),
        });
      }
      return tx.user.update({ where: { id }, data: { userType: role }, select: userSelect });
    });
  }
}
