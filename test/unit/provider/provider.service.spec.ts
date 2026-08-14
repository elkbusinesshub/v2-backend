import { Test } from '@nestjs/testing';
import { ProviderStatus, Role } from '@prisma/client';
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
  serviceArea: 'Indiranagar',
  tradeLicenseUploaded: true,
  idDocumentUploaded: true,
  status: ProviderStatus.VERIFIED,
  isAvailable: true,
  scheduleDays: [true, true, false, true, true, false, false],
  createdAt: new Date(),
  updatedAt: new Date(),
};

/**
 * What the seller's orders add up to.
 *
 * The panel's numbers used to come from `provider_requests` and from counters
 * on the profile row, neither of which anything ever wrote — so every seller
 * saw zeros. They are derived from real orders now.
 */
const activity = {
  activeOrders: 1,
  completedJobs: 38,
  totalEarnings: 2840,
  monthEarnings: 640,
  rating: 4.9,
  reviewCount: 284,
  todaysBookings: 2,
  transactions: [
    {
      icon: '🧹',
      serviceName: 'Kitchen Cleaning',
      customerName: 'Sara Mohammed',
      at: new Date('2026-08-01T09:00:00.000Z'),
      amount: 99,
    },
  ],
};

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
            sellerActivity: jest.fn().mockResolvedValue(activity),
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
    it('builds every stat from the seller’s own orders', async () => {
      const dashboard = await service.getDashboard(user);

      expect(dashboard).toMatchObject({ businessName: 'Royal Shine Co.', modeLabel: '✓ VERIFIED' });
      const stats = dashboard.stats as { label: string; value: string }[];
      expect(stats[0]).toMatchObject({ label: 'Active Orders', value: '1' });
      // This month, not all time — the card says "This Month".
      expect(stats[1]).toMatchObject({ label: 'This Month', value: '₹640' });
      expect(stats[2]).toMatchObject({ label: 'Rating', value: '4.9★', trend: '284 reviews' });
    });

    it('shows an unrated seller as New rather than 0★', async () => {
      // A bare 0★ reads as a bad score rather than an absent one.
      providers.sellerActivity.mockResolvedValue({ ...activity, rating: 0, reviewCount: 0 });

      const dashboard = await service.getDashboard(user);

      const stats = dashboard.stats as { label: string; value: string }[];
      expect(stats[2]).toMatchObject({ value: 'New', trend: '0 reviews' });
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
      expect(schedule.todaysBookingsCount).toBe(2);
    });

    it('builds earnings from completed orders, averaging per job', async () => {
      const earnings = await service.getEarnings(user);

      // 2840 across 38 jobs — derived, not read from a column nothing wrote.
      expect(earnings).toMatchObject({ totalEarnings: 2840, completedJobs: 38, avgPerJob: 74.74 });
      const txns = earnings.transactions as { title: string }[];
      expect(txns).toHaveLength(1);
      expect(txns[0]!.title).toBe('Kitchen Cleaning · Sara Mohammed');
    });

    it('does not divide by zero for a seller with no completed jobs', async () => {
      providers.sellerActivity.mockResolvedValue({
        ...activity,
        completedJobs: 0,
        totalEarnings: 0,
        transactions: [],
      });

      const earnings = await service.getEarnings(user);

      expect(earnings.avgPerJob).toBe(0);
    });
  });

  describe('availability', () => {
    it('toggles availability', async () => {
      const result = await service.setAvailability(user, { isAvailable: false });
      expect(result).toEqual({ isAvailable: false });
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
