import { Inject, Injectable } from '@nestjs/common';
import {
  AdStatus,
  ServiceVertical,
  UserType,
  type AdminModule,
  type Prisma,
  type User,
} from '@prisma/client';
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
  /**
   * Account counts per role, seller listing counts per status, and ELK's own
   * admin-run services per vertical, for the dashboard. One transaction so the
   * numbers come from the same moment.
   */
  async stats(): Promise<[number, number, number, number, number, number, number, number]> {
    const users = (userType: UserType) =>
      this.db.user.count({ where: { deletedAt: null, userType } });
    const ads = (status: AdStatus) => this.db.ad.count({ where: { deletedAt: null, status } });
    const services = (vertical: ServiceVertical) =>
      this.db.homeService.count({ where: { vertical } });
    return this.db.$transaction([
      users(UserType.USER),
      users(UserType.ADMIN),
      users(UserType.SUPER_ADMIN),
      ads(AdStatus.ACTIVE),
      ads(AdStatus.PAUSED),
      ads(AdStatus.DRAFT),
      services(ServiceVertical.CLEANING),
      services(ServiceVertical.REPAIR),
    ]);
  }
  async user(id: string): Promise<UserRow | null> {
    return this.db.user.findFirst({ where: { id, deletedAt: null }, select: userSelect });
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
