import { AdminModule, ServiceVertical, UserType } from '@prisma/client';
import { AdminAccessService, verticalsOf } from '@/common/admin-access/admin-access.service';
import type { AuthUser } from '@/common/types/auth.types';
import type { AdminAccessRepository } from '@/common/admin-access/admin-access.repository';

const user = (role: UserType): AuthUser => ({ id: 'u-1', role, jti: 'j', exp: 0 });

describe('AdminAccessService', () => {
  let modules: jest.Mock;
  let access: AdminAccessService;

  beforeEach(() => {
    modules = jest.fn().mockResolvedValue([AdminModule.RENTAL]);
    access = new AdminAccessService({ modules } as unknown as AdminAccessRepository);
  });

  it('maps Clean and Repair to their service verticals; Rental has none', () => {
    expect(verticalsOf([AdminModule.CLEAN, AdminModule.REPAIR, AdminModule.RENTAL])).toEqual([
      ServiceVertical.CLEANING,
      ServiceVertical.REPAIR,
    ]);
  });

  it('lets a Rental admin moderate rental listings only', async () => {
    await expect(access.canModerate(user(UserType.ADMIN), 'car_rental')).resolves.toBe(true);
    await expect(access.canModerate(user(UserType.ADMIN), 'cleaning')).resolves.toBe(false);
  });

  it('gives a non-admin nothing, without reading the database', async () => {
    await expect(access.has(user(UserType.PROVIDER), AdminModule.RENTAL)).resolves.toBe(false);
    expect(modules).not.toHaveBeenCalled();
  });

  it('gives an admin only the modules they hold', async () => {
    await expect(access.has(user(UserType.ADMIN), AdminModule.CLEAN)).resolves.toBe(false);
  });
});
