import { Test } from '@nestjs/testing';
import type { Address } from '@prisma/client';
import { ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import { LocationsRepository } from '@/modules/locations/locations.repository';
import { LocationsService } from '@/modules/locations/locations.service';

function makeAddress(overrides: Partial<Address> = {}): Address {
  return {
    id: 'addr-1',
    userId: 'user-1',
    label: 'Home',
    formattedAddress: 'Tower 3, Marina Bay, Al Reem Island',
    lat: 24.4539,
    lng: 54.3773,
    isDefault: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('LocationsService', () => {
  let service: LocationsService;
  let repo: jest.Mocked<LocationsRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        LocationsService,
        {
          provide: LocationsRepository,
          useValue: {
            findAllByUser: jest.fn(),
            findByIdForUser: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(LocationsService);
    repo = moduleRef.get(LocationsRepository);
  });

  describe('list', () => {
    it("returns the user's addresses", async () => {
      repo.findAllByUser.mockResolvedValue([makeAddress()]);

      const result = await service.list('user-1');

      expect(repo.findAllByUser).toHaveBeenCalledWith('user-1');
      expect(result).toHaveLength(1);
    });
  });

  describe('create', () => {
    it('delegates straight to the repository', async () => {
      const dto = { label: 'Home', formattedAddress: 'Al Reem Island', lat: 24.45, lng: 54.37 };
      repo.create.mockResolvedValue(makeAddress());

      await service.create('user-1', dto);

      expect(repo.create).toHaveBeenCalledWith('user-1', dto);
    });
  });

  describe('update', () => {
    it('updates an address the user owns', async () => {
      repo.findByIdForUser.mockResolvedValue(makeAddress());
      repo.update.mockResolvedValue(makeAddress({ label: 'Work' }));

      const result = await service.update('user-1', 'addr-1', { label: 'Work' });

      expect(repo.findByIdForUser).toHaveBeenCalledWith('addr-1', 'user-1');
      expect(repo.update).toHaveBeenCalledWith('addr-1', 'user-1', { label: 'Work' });
      expect(result.label).toBe('Work');
    });

    it("rejects updating another user's address", async () => {
      repo.findByIdForUser.mockResolvedValue(null);

      await expect(service.update('user-2', 'addr-1', { label: 'Work' })).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('removes an address the user owns', async () => {
      repo.findByIdForUser.mockResolvedValue(makeAddress());

      await service.remove('user-1', 'addr-1');

      expect(repo.remove).toHaveBeenCalledWith('addr-1');
    });

    it("rejects removing another user's address", async () => {
      repo.findByIdForUser.mockResolvedValue(null);

      await expect(service.remove('user-2', 'addr-1')).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
      expect(repo.remove).not.toHaveBeenCalled();
    });
  });
});
