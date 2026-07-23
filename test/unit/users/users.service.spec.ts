import { Test } from '@nestjs/testing';
import { Prisma, Role, type User } from '@prisma/client';
import { ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import { UsersRepository } from '@/modules/users/users.repository';
import { UsersService } from '@/modules/users/users.service';

const user: User = {
  id: 'u-1',
  phone: '+971500000001',
  email: null,
  name: null,
  roles: [Role.USER],
  language: 'en',
  rewardPoints: 0,
  walletBalance: new Prisma.Decimal(0),
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

describe('UsersService', () => {
  let service: UsersService;
  let repo: jest.Mocked<UsersRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: UsersRepository,
          useValue: {
            findById: jest.fn().mockResolvedValue(user),
            updateProfile: jest.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
    repo = moduleRef.get(UsersRepository);
  });

  describe('getProfile', () => {
    it('maps the user row to the profile shape with narrowed roles', async () => {
      const profile = await service.getProfile('u-1');

      expect(profile).toEqual({
        id: 'u-1',
        phone: '+971500000001',
        email: null,
        name: null,
        language: 'en',
        roles: [Role.USER],
      });
    });

    it('404s for an unknown user', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.getProfile('ghost')).rejects.toBeInstanceOf(ResourceNotFoundException);
    });
  });

  describe('updateProfile', () => {
    it('updates the provided fields', async () => {
      repo.updateProfile.mockResolvedValue({ ...user, name: 'Ahmed', language: 'ar' });

      const profile = await service.updateProfile('u-1', { name: 'Ahmed', language: 'ar' });

      expect(repo.updateProfile).toHaveBeenCalledWith('u-1', { name: 'Ahmed', language: 'ar' });
      expect(profile.name).toBe('Ahmed');
      expect(profile.language).toBe('ar');
    });

    it('skips the write when no fields are provided', async () => {
      const profile = await service.updateProfile('u-1', {});

      expect(repo.updateProfile).not.toHaveBeenCalled();
      expect(profile.id).toBe('u-1');
    });
  });
});
