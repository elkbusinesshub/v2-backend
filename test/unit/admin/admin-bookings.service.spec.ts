import { Test } from '@nestjs/testing';
import { ServiceBookingStatus, ServiceVertical } from '@prisma/client';
import { DomainException } from '@/common/errors/domain.exceptions';
import { AdminBookingsService } from '@/modules/admin/admin-bookings.service';
import { AdminRepository } from '@/modules/admin/admin.repository';
import { HomeServicesRepository } from '@/modules/home-services/home-services.repository';
import { NotificationsService } from '@/modules/notifications/notifications.service';

const { PENDING, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED } = ServiceBookingStatus;

function row(overrides: Record<string, unknown> = {}): never {
  return {
    id: 'b-1',
    code: 'ELK-S-AAAAA',
    userId: 'u-1',
    serviceId: 's-1',
    serviceName: 'Home cleaning',
    vertical: ServiceVertical.CLEANING,
    category: 'cln',
    hours: 2,
    professionals: 1,
    withMaterials: false,
    scheduledDate: new Date('2099-01-10T00:00:00Z'),
    timeSlot: '10:00',
    addressLabel: 'Home',
    addressText: 'Kakkanad',
    lat: null,
    lng: null,
    directions: null,
    contactPhone: '+91',
    locationId: null,
    professionalId: null,
    status: PENDING,
    baseAmount: 598,
    materialsAmount: 0,
    discountAmount: 0,
    totalAmount: 598,
    promoCode: null,
    confirmedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: { name: 'Anjali' },
    location: null,
    professional: null,
    ...overrides,
  } as never;
}

describe('AdminBookingsService', () => {
  let svc: AdminBookingsService;
  let repo: jest.Mocked<AdminRepository>;
  let bookings: jest.Mocked<HomeServicesRepository>;
  let notifications: jest.Mocked<NotificationsService>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminBookingsService,
        {
          provide: AdminRepository,
          useValue: {
            professional: jest
              .fn()
              .mockResolvedValue({ id: 'p-1', name: 'Anil Kumar', onDuty: true }),
            bookings: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: HomeServicesRepository,
          useValue: {
            findBooking: jest.fn().mockResolvedValue(row()),
            updateBooking: jest.fn().mockImplementation((_id, data) => Promise.resolve(row(data))),
          },
        },
        { provide: NotificationsService, useValue: { create: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();
    svc = moduleRef.get(AdminBookingsService);
    repo = moduleRef.get(AdminRepository);
    bookings = moduleRef.get(HomeServicesRepository);
    notifications = moduleRef.get(NotificationsService);
  });

  it('confirms a pending booking by assigning a professional, and tells the customer', async () => {
    const result = await svc.assign('b-1', 'p-1');

    expect(bookings.updateBooking).toHaveBeenCalledWith(
      'b-1',
      expect.objectContaining({ professionalId: 'p-1', status: CONFIRMED }),
    );
    expect(result.status).toBe(CONFIRMED);
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-1', title: 'Booking confirmed' }),
    );
  });

  it('will not assign someone who is off duty', async () => {
    repo.professional.mockResolvedValue({ id: 'p-2', name: 'Joseph', onDuty: false } as never);
    await expect(svc.assign('b-1', 'p-2')).rejects.toBeInstanceOf(DomainException);
  });

  it('will not reassign a finished job', async () => {
    bookings.findBooking.mockResolvedValue(row({ status: COMPLETED }));
    await expect(svc.assign('b-1', 'p-1')).rejects.toBeInstanceOf(DomainException);
  });

  it('will not start a job with nobody assigned', async () => {
    bookings.findBooking.mockResolvedValue(row({ status: CONFIRMED }));
    await expect(svc.setStatus('b-1', IN_PROGRESS)).rejects.toMatchObject({
      code: 'NOT_ASSIGNED',
    });
  });

  it('walks a job forward: confirmed → in progress → completed', async () => {
    bookings.findBooking.mockResolvedValue(row({ status: CONFIRMED, professionalId: 'p-1' }));
    await expect(svc.setStatus('b-1', IN_PROGRESS)).resolves.toMatchObject({ status: IN_PROGRESS });

    bookings.findBooking.mockResolvedValue(row({ status: IN_PROGRESS, professionalId: 'p-1' }));
    await expect(svc.setStatus('b-1', COMPLETED)).resolves.toMatchObject({ status: COMPLETED });
    expect(bookings.updateBooking).toHaveBeenLastCalledWith(
      'b-1',
      expect.objectContaining({ completedAt: expect.any(Date) }),
    );
  });

  it('refuses to cancel a job already under way', async () => {
    bookings.findBooking.mockResolvedValue(row({ status: IN_PROGRESS }));
    await expect(svc.setStatus('b-1', CANCELLED)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('keeps the change when the notification fails', async () => {
    notifications.create.mockRejectedValue(new Error('push down'));
    await expect(svc.assign('b-1', 'p-1')).resolves.toMatchObject({ status: CONFIRMED });
  });
});
