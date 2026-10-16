import { Test } from '@nestjs/testing';
import { AdminModule, UserType } from '@prisma/client';
import {
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import { AdminUsersService } from '@/modules/admin/admin-users.service';
import { AdminUsersQueryDto } from '@/modules/admin/admin.dto';
import { AdminUsersRepository } from '@/modules/admin/admin-users.repository';

const priya = {
  id: 'u-1',
  name: 'Priya Menon',
  phone: '+912222222222',
  userType: UserType.USER,
  createdAt: new Date('2026-09-01T10:00:00Z'),
  adminModules: [] as { module: AdminModule }[],
  professional: null,
};

describe('AdminUsersService', () => {
  let svc: AdminUsersService;
  let repo: jest.Mocked<AdminUsersRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminUsersService,
        {
          provide: AdminUsersRepository,
          useValue: {
            page: jest.fn().mockResolvedValue([[priya], 21]),
            user: jest.fn().mockResolvedValue(priya),
            setAccess: jest.fn().mockImplementation((id, userType, modules: AdminModule[]) =>
              Promise.resolve({
                ...priya,
                userType,
                adminModules: modules.map((module) => ({ module })),
              }),
            ),
          },
        },
      ],
    }).compile();
    svc = moduleRef.get(AdminUsersService);
    repo = moduleRef.get(AdminUsersRepository);
  });

  it('lists users a page at a time, with name, phone, role and join date', async () => {
    const query = Object.assign(new AdminUsersQueryDto(), { search: 'priya', page: 2, limit: 20 });
    const { items, meta } = await svc.list(query);
    expect(repo.page).toHaveBeenCalledWith('priya', 20, 20);
    expect(meta).toEqual({ page: 2, limit: 20, total: 21, totalPages: 2 });
    expect(items).toEqual([
      {
        id: 'u-1',
        name: 'Priya Menon',
        phone: '+912222222222',
        role: 'USER',
        modules: [],
        joinedAt: '2026-09-01T10:00:00.000Z',
      },
    ]);
  });

  it('makes someone an admin of the modules chosen', async () => {
    const updated = await svc.setRole('u-1', UserType.ADMIN, 'u-super', ['RENTAL', 'CLEAN']);
    expect(repo.setAccess).toHaveBeenCalledWith('u-1', UserType.ADMIN, ['CLEAN', 'RENTAL']);
    expect(updated).toMatchObject({ role: 'ADMIN', modules: ['CLEAN', 'RENTAL'] });
  });

  it('needs at least one module for an admin', async () => {
    await expect(svc.setRole('u-1', UserType.ADMIN, 'u-super', [])).rejects.toBeInstanceOf(
      ValidationFailedException,
    );
    expect(repo.setAccess).not.toHaveBeenCalled();
  });

  it('changes an admin’s modules without changing the role', async () => {
    repo.user.mockResolvedValue({
      ...priya,
      userType: UserType.ADMIN,
      adminModules: [{ module: 'CLEAN' }],
    });
    await svc.setRole('u-1', UserType.ADMIN, 'u-super', ['REPAIR']);
    expect(repo.setAccess).toHaveBeenCalledWith('u-1', UserType.ADMIN, ['REPAIR']);
  });

  it('takes the modules away when an admin becomes something else', async () => {
    repo.user.mockResolvedValue({
      ...priya,
      userType: UserType.ADMIN,
      adminModules: [{ module: 'CLEAN' }],
    });
    await svc.setRole('u-1', UserType.USER, 'u-super', ['CLEAN']);
    expect(repo.setAccess).toHaveBeenCalledWith('u-1', UserType.USER, []);
  });

  it('will not let the super admin change their own role', async () => {
    await expect(svc.setRole('u-super', UserType.USER, 'u-super')).rejects.toMatchObject({
      code: 'OWN_ROLE',
    });
    expect(repo.setAccess).not.toHaveBeenCalled();
  });

  it('does nothing when the role is already the one asked for', async () => {
    await svc.setRole('u-1', UserType.USER, 'u-super');
    expect(repo.setAccess).not.toHaveBeenCalled();
  });

  it('reports a user that does not exist', async () => {
    repo.user.mockResolvedValue(null);
    await expect(svc.setRole('u-9', UserType.ADMIN, 'u-super', ['CLEAN'])).rejects.toBeInstanceOf(
      ResourceNotFoundException,
    );
  });
});
