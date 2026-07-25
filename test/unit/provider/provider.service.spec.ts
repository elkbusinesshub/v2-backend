import { Test } from '@nestjs/testing';
import { Prisma, ProviderRequestStatus, ProviderStatus, Role } from '@prisma/client';
import {
  DuplicateResourceException,
  ForbiddenResourceException,
  ResourceNotFoundException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { UsersRepository } from '@/modules/users/users.repository';
import { ProviderRepository } from '@/modules/provider/provider.repository';
import { ProviderService } from '@/modules/provider/provider.service';

const user: AuthUser = { id: 'u-1', roles: [Role.USER], jti: 'j', exp: 9999999999 };

const profile = {
  id: 'pp-1',
  userId: 'u-1',
  businessName: 'Royal Shine Co.',
  serviceCategory: 'Cleaning',
  contactNumber: '+971500000002',
  serviceArea: 'Dubai Marina',
  tradeLicenseUploaded: true,
  idDocumentUploaded: true,
  status: ProviderStatus.VERIFIED,
  isAvailable: true,
  rating: new Prisma.Decimal(4.9),
  reviewCount: 284,
  totalEarnings: new Prisma.Decimal(2840),
  completedJobs: 38,
  avgPerJob: new Prisma.Decimal(74),
  scheduleDays: [true, true, false, true, true, false, false],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const requests = [
  {
    id: 'r-1',
    providerId: 'pp-1',
    serviceName: 'Deep Home Cleaning',
    customerName: 'Ahmed Al-Rashid',
    location: 'Dubai Marina',
    timeLabel: 'Today 12:00 PM',
    amount: new Prisma.Decimal(149),
    status: ProviderRequestStatus.PENDING,
    icon: '🧹',
    colorHex: 0xffe0f7f5,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'r-2',
    providerId: 'pp-1',
    serviceName: 'Kitchen Cleaning',
    customerName: 'Sara Mohammed',
    location: 'JBR',
    timeLabel: 'Today 4:00 PM',
    amount: new Prisma.Decimal(99),
    status: ProviderRequestStatus.ACCEPTED,
    icon: '💳',
    colorHex: 0xffd1fae5,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

describe('ProviderService', () => {
  let service: ProviderService;
  let providers: jest.Mocked<ProviderRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProviderService,
        {
          provide: ProviderRepository,
          useValue: {
            findProfileByUser: jest.fn().mockResolvedValue(profile),
            createProfile: jest
              .fn()
              .mockResolvedValue({ ...profile, status: ProviderStatus.PENDING }),
            updateProfile: jest
              .fn()
              .mockImplementation((_id, data) => Promise.resolve({ ...profile, ...data })),
            setStatusAndRole: jest
              .fn()
              .mockResolvedValue({ ...profile, status: ProviderStatus.VERIFIED }),
            listRequests: jest.fn().mockResolvedValue(requests),
            findRequestForProvider: jest.fn().mockResolvedValue(requests[0]),
            respondToRequest: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: UsersRepository,
          useValue: {
            findById: jest.fn().mockResolvedValue({ id: 'u-1', roles: [Role.USER] }),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(ProviderService);
    providers = moduleRef.get(ProviderRepository);
  });

  describe('register', () => {
    const dto = {
      businessName: 'New Co.',
      serviceCategory: 'Plumbing',
      contactNumber: '+971500000009',
      serviceArea: 'JLT',
      tradeLicenseUploaded: true,
      idDocumentUploaded: true,
    };

    it('creates a PENDING profile', async () => {
      providers.findProfileByUser.mockResolvedValue(null);
      const result = await service.register(user, dto);
      expect(result.status).toBe('pending');
      expect(providers.createProfile).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1', businessName: 'New Co.' }),
      );
    });

    it('rejects a duplicate registration', async () => {
      await expect(service.register(user, dto)).rejects.toBeInstanceOf(DuplicateResourceException);
    });
  });

  describe('dashboard', () => {
    it('maps stats + requests, counting accepted as active orders', async () => {
      const dashboard = await service.getDashboard(user);
      expect(dashboard).toMatchObject({ businessName: 'Royal Shine Co.', modeLabel: '✓ VERIFIED' });
      const stats = dashboard.stats as { label: string; value: string }[];
      expect(stats[0]).toMatchObject({ label: 'Active Orders', value: '1' });
      expect(stats[1]).toMatchObject({ label: 'This Month', value: 'AED 2,840' });
      expect(stats[2]).toMatchObject({ label: 'Rating', value: '4.9★', trend: '284 reviews' });
      expect(dashboard.requests).toHaveLength(2);
    });

    it('403s a user without a provider profile', async () => {
      providers.findProfileByUser.mockResolvedValue(null);
      await expect(service.getDashboard(user)).rejects.toBeInstanceOf(ForbiddenResourceException);
    });
  });

  describe('schedule & earnings', () => {
    it('renders the weekly availability from the stored scheduleDays', async () => {
      const schedule = await service.getSchedule(user);
      const days = schedule.days as { label: string; available: boolean }[];
      expect(days).toHaveLength(7);
      expect(days[2]!.available).toBe(false); // Wednesday off
      expect(schedule.todaysBookingsCount).toBe(2); // 1 accepted + 1 pending
    });

    it('builds earnings transactions from accepted requests only', async () => {
      const earnings = await service.getEarnings(user);
      expect(earnings).toMatchObject({ totalEarnings: 2840, completedJobs: 38, avgPerJob: 74 });
      const txns = earnings.transactions as { title: string }[];
      expect(txns).toHaveLength(1);
      expect(txns[0]!.title).toBe('Kitchen Cleaning · Sara Mohammed');
    });
  });

  describe('availability & requests', () => {
    it('toggles availability', async () => {
      const result = await service.setAvailability(user, { isAvailable: false });
      expect(result).toEqual({ isAvailable: false });
    });

    it('accepts a pending request', async () => {
      const result = await service.respondToRequest(user, 'r-1', { accept: true });
      expect(providers.respondToRequest).toHaveBeenCalledWith('r-1', true);
      expect(result.id).toBe('r-1');
    });

    it('409s an already-handled request', async () => {
      providers.respondToRequest.mockResolvedValue(false);
      await expect(service.respondToRequest(user, 'r-1', { accept: true })).rejects.toMatchObject({
        code: 'REQUEST_ALREADY_HANDLED',
      });
    });

    it('404s a request not belonging to the provider', async () => {
      providers.findRequestForProvider.mockResolvedValue(null);
      await expect(service.respondToRequest(user, 'r-x', { accept: false })).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });
  });

  describe('verify (admin)', () => {
    it('grants the PROVIDER role on verification', async () => {
      providers.findProfileByUser.mockResolvedValue({ ...profile, status: ProviderStatus.PENDING });
      await service.verify('u-1', { decision: 'verified' });
      expect(providers.setStatusAndRole).toHaveBeenCalledWith(
        'pp-1',
        'u-1',
        'VERIFIED',
        expect.arrayContaining([Role.USER, Role.PROVIDER]),
      );
    });

    it('rejects without granting a role', async () => {
      providers.findProfileByUser.mockResolvedValue({ ...profile, status: ProviderStatus.PENDING });
      const result = await service.verify('u-1', { decision: 'rejected' });
      expect(result.status).toBe('rejected');
      expect(providers.setStatusAndRole).not.toHaveBeenCalled();
    });

    it('404s an unknown provider profile', async () => {
      providers.findProfileByUser.mockResolvedValue(null);
      await expect(service.verify('u-x', { decision: 'verified' })).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });
  });
});
