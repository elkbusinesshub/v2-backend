import { ServiceBookingStatus, ServiceVertical } from '@prisma/client';
import { DomainException } from '@/common/errors/domain.exceptions';
import { accountPhone } from '@/modules/admin/admin-catalog.service';
import type { AdminBookingsService } from '@/modules/admin/admin-bookings.service';
import type { HomeServicesRepository } from '@/modules/home-services/home-services.repository';
import { todayInIndia } from '@/modules/home-services/home-services.rules';
import type { ProRepository } from '@/modules/pro/pro.repository';
import { ProService } from '@/modules/pro/pro.service';

const { CONFIRMED, IN_PROGRESS, COMPLETED } = ServiceBookingStatus;

const pro = {
  id: 'p-1',
  name: 'Anil Kumar',
  phone: '+91 98765 43210',
  experienceYears: 4,
  skills: 'Home, Kitchen',
  location: null,
  onDuty: true,
} as never;

function job(overrides: Record<string, unknown> = {}): never {
  return {
    id: 'b-1',
    code: 'ELK-S-AAAAA',
    userId: 'u-9',
    serviceName: 'Home cleaning',
    vertical: ServiceVertical.CLEANING,
    scheduledDate: new Date(`${todayInIndia()}T00:00:00Z`),
    timeSlot: '10:00',
    professionalId: 'p-1',
    status: CONFIRMED,
    baseAmount: 598,
    materialsAmount: 0,
    discountAmount: 0,
    totalAmount: 598,
    createdAt: new Date(),
    user: { name: 'Anjali' },
    ...overrides,
  } as never;
}

describe('ProService', () => {
  let repo: jest.Mocked<
    Pick<ProRepository, 'byUser' | 'createForAccount' | 'jobs' | 'count' | 'doneSince' | 'setDuty'>
  >;
  let bookings: { findBooking: jest.Mock };
  let admin: { setStatus: jest.Mock };
  let svc: ProService;

  beforeEach(() => {
    repo = {
      byUser: jest.fn().mockResolvedValue(pro),
      createForAccount: jest.fn().mockResolvedValue(null),
      jobs: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      doneSince: jest.fn().mockResolvedValue(0),
      setDuty: jest.fn(),
    };
    bookings = { findBooking: jest.fn() };
    admin = { setStatus: jest.fn().mockResolvedValue({ id: 'b-1' }) };
    svc = new ProService(
      repo as unknown as ProRepository,
      bookings as unknown as HomeServicesRepository,
      admin as unknown as AdminBookingsService,
    );
  });

  it('refuses an account that is not a professional', async () => {
    repo.byUser.mockResolvedValue(null);
    await expect(svc.profile('u-1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('sets up a professional for an account made PROFESSIONAL in the database', async () => {
    repo.byUser.mockResolvedValue(null);
    repo.createForAccount.mockResolvedValue(pro);
    await expect(svc.profile('u-1')).resolves.toMatchObject({ name: 'Anil Kumar' });
    expect(repo.createForAccount).toHaveBeenCalledWith('u-1');
  });

  it('hides a job assigned to someone else', async () => {
    bookings.findBooking.mockResolvedValue(job({ professionalId: 'p-2' }));
    await expect(svc.job('u-1', 'b-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('starts a confirmed job on its day, through the admin flow that notifies the customer', async () => {
    bookings.findBooking.mockResolvedValue(job());
    await svc.start('u-1', 'b-1');
    expect(admin.setStatus).toHaveBeenCalledWith('b-1', IN_PROGRESS);
  });

  it('will not start a job before its day', async () => {
    bookings.findBooking.mockResolvedValue(
      job({ scheduledDate: new Date('2099-01-10T00:00:00Z') }),
    );
    await expect(svc.start('u-1', 'b-1')).rejects.toMatchObject({ code: 'TOO_EARLY' });
    expect(admin.setStatus).not.toHaveBeenCalled();
  });

  it('only completes a job that has started', async () => {
    bookings.findBooking.mockResolvedValue(job());
    await expect(svc.complete('u-1', 'b-1')).rejects.toBeInstanceOf(DomainException);

    bookings.findBooking.mockResolvedValue(job({ status: IN_PROGRESS }));
    await svc.complete('u-1', 'b-1');
    expect(admin.setStatus).toHaveBeenCalledWith('b-1', COMPLETED);
  });

  it('reports job counts on the profile', async () => {
    repo.count.mockImplementation((_id, view) =>
      Promise.resolve({ today: 2, upcoming: 3, done: 9 }[view]),
    );
    repo.doneSince.mockResolvedValue(4);
    const me = await svc.profile('u-1');
    expect(me.stats).toEqual({ today: 2, upcoming: 3, doneThisMonth: 4, doneTotal: 9 });
  });
});

describe('accountPhone', () => {
  it('turns the panel format into the account phone', () => {
    expect(accountPhone('+91 98765 43210')).toBe('+919876543210');
    expect(accountPhone('98765 43210')).toBe('+919876543210');
  });
});
