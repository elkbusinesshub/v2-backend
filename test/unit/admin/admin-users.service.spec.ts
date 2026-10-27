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
  email: null as string | null,
  userType: UserType.USER,
  createdAt: new Date('2026-09-01T10:00:00Z'),
  adminModules: [] as { module: AdminModule }[],
  professional: null,
};

const anu = {
  ...priya,
  id: 'u-2',
  name: 'Anu (ELK Clean)',
  phone: '+919999999999',
  userType: UserType.ADMIN,
  adminModules: [{ module: 'CLEAN' as AdminModule }],
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
            taken: jest.fn().mockResolvedValue(false),
            createStaff: jest.fn().mockImplementation((data) =>
              Promise.resolve({
                ...priya,
                id: 'u-new',
                userType: data.role,
                name: data.name,
                phone: data.phone,
                email: data.email,
                adminModules: data.modules.map((module: AdminModule) => ({ module })),
              }),
            ),
            updateStaff: jest.fn().mockImplementation((id, data, modules?: AdminModule[]) =>
              Promise.resolve({
                ...anu,
                ...data,
                adminModules: (modules ?? ['CLEAN']).map((module) => ({ module })),
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
        email: null,
        role: 'USER',
        modules: [],
        joinedAt: '2026-09-01T10:00:00.000Z',
      },
    ]);
  });

  it('creates an admin of the modules chosen, with a normalised number', async () => {
    const created = await svc.createStaff(
      {
        role: UserType.ADMIN,
        name: ' Anu ',
        phone: '98765 43210',
        email: 'Anu@Example.com',
        modules: ['RENTAL', 'CLEAN'],
      },
      'u-super',
    );
    expect(repo.createStaff).toHaveBeenCalledWith({
      role: UserType.ADMIN,
      name: 'Anu',
      phone: '+919876543210',
      email: 'anu@example.com',
      modules: ['CLEAN', 'RENTAL'],
    });
    expect(created).toMatchObject({ role: 'ADMIN', modules: ['CLEAN', 'RENTAL'] });
  });

  it('creates a super admin, who runs no modules', async () => {
    await svc.createStaff(
      { role: UserType.SUPER_ADMIN, name: 'Ravi', phone: '+918888888888', modules: ['CLEAN'] },
      'u-super',
    );
    expect(repo.createStaff).toHaveBeenCalledWith(
      expect.objectContaining({ role: UserType.SUPER_ADMIN, modules: [], email: null }),
    );
  });

  it('needs at least one module for a new admin', async () => {
    await expect(
      svc.createStaff(
        { role: UserType.ADMIN, name: 'Anu', phone: '9876543210', modules: [] },
        'u-super',
      ),
    ).rejects.toBeInstanceOf(ValidationFailedException);
    expect(repo.createStaff).not.toHaveBeenCalled();
  });

  it('will not make staff of a number that already has an account', async () => {
    // A customer's number stays a customer's: an account's role never changes.
    repo.taken.mockImplementation((field) => Promise.resolve(field === 'phone'));
    await expect(
      svc.createStaff(
        { role: UserType.ADMIN, name: 'Priya', phone: '2222222222', modules: ['CLEAN'] },
        'u-super',
      ),
    ).rejects.toMatchObject({ code: 'PHONE_IN_USE' });
    expect(repo.createStaff).not.toHaveBeenCalled();
  });

  it('edits an admin’s details and modules, never the role', async () => {
    repo.user.mockResolvedValue(anu);
    const updated = await svc.updateStaff(
      'u-2',
      { name: 'Anu K', email: '', modules: ['REPAIR'] },
      'u-super',
    );
    expect(repo.updateStaff).toHaveBeenCalledWith('u-2', { name: 'Anu K', email: null }, [
      'REPAIR',
    ]);
    expect(updated.role).toBe('ADMIN');
  });

  it('checks a changed number against the other accounts', async () => {
    repo.user.mockResolvedValue(anu);
    await svc.updateStaff('u-2', { phone: '9000000001' }, 'u-super');
    expect(repo.taken).toHaveBeenCalledWith('phone', '+919000000001', 'u-2');
  });

  it('gives a super admin no modules', async () => {
    repo.user.mockResolvedValue({ ...anu, userType: UserType.SUPER_ADMIN, adminModules: [] });
    await expect(svc.updateStaff('u-2', { modules: ['CLEAN'] }, 'u-super')).rejects.toBeInstanceOf(
      ValidationFailedException,
    );
  });

  it('does not edit customer accounts', async () => {
    await expect(svc.updateStaff('u-1', { name: 'X' }, 'u-super')).rejects.toMatchObject({
      code: 'CUSTOMER_ACCOUNT',
    });
    expect(repo.updateStaff).not.toHaveBeenCalled();
  });

  it('reports an account that does not exist', async () => {
    repo.user.mockResolvedValue(null);
    await expect(svc.updateStaff('u-9', { name: 'X' }, 'u-super')).rejects.toBeInstanceOf(
      ResourceNotFoundException,
    );
  });
});
