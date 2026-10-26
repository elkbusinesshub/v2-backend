import { Test } from '@nestjs/testing';
import {
  ProfessionalStatus,
  ServiceBookingStatus,
  ServiceVertical,
  WhatsappStatus,
} from '@prisma/client';
import { DomainException, ForbiddenResourceException } from '@/common/errors/domain.exceptions';
import { AdminBookingsService } from '@/modules/admin/admin-bookings.service';
import { AdminRepository } from '@/modules/admin/admin.repository';
import { HomeServicesRepository } from '@/modules/home-services/home-services.repository';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { RazorpayService } from '@/modules/razorpay/razorpay.service';
import { WhatsappService } from '@/modules/whatsapp/whatsapp.service';

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
    companyId: 'co-1',
    professionalId: null,
    professionalName: null,
    professionalPhone: null,
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

const BOTH = [ServiceVertical.CLEANING, ServiceVertical.REPAIR];

function pro(overrides: Record<string, unknown> = {}): never {
  return {
    id: 'p-1',
    companyId: 'co-1',
    name: 'Anil Kumar',
    phone: '+919847021456',
    status: ProfessionalStatus.APPROVED,
    categories: [{ category: 'cln' }],
    ...overrides,
  } as never;
}

describe('AdminBookingsService', () => {
  let svc: AdminBookingsService;
  let repo: jest.Mocked<AdminRepository>;
  let bookings: jest.Mocked<HomeServicesRepository>;
  let notifications: jest.Mocked<NotificationsService>;
  let razorpay: jest.Mocked<RazorpayService>;
  let whatsapp: jest.Mocked<WhatsappService>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminBookingsService,
        {
          provide: AdminRepository,
          useValue: {
            professional: jest.fn().mockResolvedValue(pro()),
            bookings: jest.fn().mockResolvedValue([]),
            companyName: jest.fn().mockResolvedValue('Shine Home Services'),
            logWhatsapp: jest
              .fn()
              .mockImplementation((data) =>
                Promise.resolve({ ...data, id: 'w-1', createdAt: new Date() }),
              ),
            lastWhatsapp: jest.fn().mockResolvedValue(new Map()),
          },
        },
        {
          provide: HomeServicesRepository,
          useValue: {
            findBooking: jest.fn().mockResolvedValue(row()),
            updateBooking: jest.fn().mockImplementation((_id, data) => Promise.resolve(row(data))),
            cancelBooking: jest
              .fn()
              .mockResolvedValue(
                row({ status: CANCELLED, paymentMethod: 'razorpay', totalAmount: 1944 }),
              ),
          },
        },
        { provide: RazorpayService, useValue: { refund: jest.fn().mockResolvedValue(undefined) } },
        { provide: NotificationsService, useValue: { create: jest.fn().mockResolvedValue({}) } },
        {
          provide: WhatsappService,
          useValue: {
            templateName: 'elk_job_assigned',
            sendTemplate: jest.fn().mockResolvedValue({
              status: WhatsappStatus.SENT,
              messageId: 'wamid.1',
              error: null,
            }),
          },
        },
      ],
    }).compile();
    svc = moduleRef.get(AdminBookingsService);
    repo = moduleRef.get(AdminRepository);
    bookings = moduleRef.get(HomeServicesRepository);
    notifications = moduleRef.get(NotificationsService);
    razorpay = moduleRef.get(RazorpayService);
    whatsapp = moduleRef.get(WhatsappService);
  });

  it('assigning confirms the booking, tells the customer, and WhatsApps the professional', async () => {
    const result = await svc.assign('co-1', 'b-1', 'p-1', BOTH);

    expect(bookings.updateBooking).toHaveBeenCalledWith(
      'b-1',
      expect.objectContaining({
        professionalId: 'p-1',
        professionalName: 'Anil Kumar',
        status: CONFIRMED,
      }),
    );
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-1', title: 'Booking confirmed' }),
    );
    const [to, params] = whatsapp.sendTemplate.mock.calls[0]!;
    expect(to).toBe('+919847021456');
    expect(params[0]).toBe('Anil Kumar');
    expect(params[1]).toBe('Shine Home Services');
    expect(params[9]).toContain('google.com/maps');
    expect(result).toMatchObject({ status: CONFIRMED, whatsapp: { status: WhatsappStatus.SENT } });
  });

  it('keeps the assignment when WhatsApp fails, and reports it', async () => {
    whatsapp.sendTemplate.mockResolvedValue({
      status: WhatsappStatus.FAILED,
      messageId: null,
      error: '401 190 Invalid OAuth access token',
    });
    const result = await svc.assign('co-1', 'b-1', 'p-1', BOTH);
    expect(result.status).toBe(CONFIRMED);
    expect(result.whatsapp).toMatchObject({ status: WhatsappStatus.FAILED });
  });

  it('only assigns a professional the super admin has approved', async () => {
    repo.professional.mockResolvedValue(pro({ status: ProfessionalStatus.PENDING }));
    await expect(svc.assign('co-1', 'b-1', 'p-1', BOTH)).rejects.toMatchObject({
      code: 'NOT_APPROVED',
    });
    expect(bookings.updateBooking).not.toHaveBeenCalled();
  });

  it('only assigns a professional who does the booking’s service', async () => {
    repo.professional.mockResolvedValue(pro({ categories: [{ category: 'plm' }] }));
    await expect(svc.assign('co-1', 'b-1', 'p-1', BOTH)).rejects.toMatchObject({
      code: 'WRONG_CATEGORY',
    });
  });

  it('does not show one company another company’s booking', async () => {
    await expect(svc.assign('co-2', 'b-1', 'p-1', BOTH)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('will not reassign a finished job', async () => {
    bookings.findBooking.mockResolvedValue(row({ status: COMPLETED }));
    await expect(svc.assign('co-1', 'b-1', 'p-1', BOTH)).rejects.toBeInstanceOf(DomainException);
  });

  it('resends the job to the assigned professional', async () => {
    bookings.findBooking.mockResolvedValue(row({ status: CONFIRMED, professionalId: 'p-1' }));
    await svc.resend('co-1', 'b-1', BOTH);
    expect(whatsapp.sendTemplate).toHaveBeenCalledTimes(1);
    expect(repo.logWhatsapp).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: 'b-1', professionalId: 'p-1', sentById: 'co-1' }),
    );
  });

  it('will not start a job with nobody assigned', async () => {
    bookings.findBooking.mockResolvedValue(row({ status: CONFIRMED }));
    await expect(svc.setStatus('co-1', 'b-1', IN_PROGRESS, BOTH)).rejects.toMatchObject({
      code: 'NOT_ASSIGNED',
    });
  });

  it('walks a job forward: confirmed → in progress → completed', async () => {
    bookings.findBooking.mockResolvedValue(row({ status: CONFIRMED, professionalId: 'p-1' }));
    await expect(svc.setStatus('co-1', 'b-1', IN_PROGRESS, BOTH)).resolves.toMatchObject({
      status: IN_PROGRESS,
    });

    bookings.findBooking.mockResolvedValue(row({ status: IN_PROGRESS, professionalId: 'p-1' }));
    await expect(svc.setStatus('co-1', 'b-1', COMPLETED, BOTH)).resolves.toMatchObject({
      status: COMPLETED,
    });
    expect(bookings.updateBooking).toHaveBeenLastCalledWith(
      'b-1',
      expect.objectContaining({ completedAt: expect.any(Date) }),
    );
  });

  it('refunds a Razorpay booking in full when the company cancels, however late', async () => {
    bookings.findBooking.mockResolvedValue(
      row({ status: CONFIRMED, createdAt: new Date('2000-01-01T00:00:00Z') }),
    );
    bookings.cancelBooking.mockResolvedValue(
      row({ status: CANCELLED, paymentMethod: 'razorpay', totalAmount: 1944 }),
    );
    await svc.setStatus('co-1', 'b-1', CANCELLED, BOTH);
    expect(bookings.cancelBooking).toHaveBeenCalledWith('b-1', [CONFIRMED]);
    expect(razorpay.refund).toHaveBeenCalledWith('b-1', 1944);
  });

  it('refuses to cancel a job already under way', async () => {
    bookings.findBooking.mockResolvedValue(row({ status: IN_PROGRESS }));
    await expect(svc.setStatus('co-1', 'b-1', CANCELLED, BOTH)).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('keeps the change when the notification fails', async () => {
    notifications.create.mockRejectedValue(new Error('push down'));
    await expect(svc.assign('co-1', 'b-1', 'p-1', BOTH)).resolves.toMatchObject({
      status: CONFIRMED,
    });
  });

  it('keeps an ELK Repair admin away from a cleaning booking', async () => {
    await expect(svc.assign('co-1', 'b-1', 'p-1', [ServiceVertical.REPAIR])).rejects.toBeInstanceOf(
      ForbiddenResourceException,
    );
    expect(bookings.updateBooking).not.toHaveBeenCalled();
  });

  it('lists only the company’s bookings, in the admin’s verticals', async () => {
    await svc.list('co-1', undefined, [ServiceVertical.CLEANING]);
    expect(repo.bookings).toHaveBeenCalledWith('co-1', undefined, [ServiceVertical.CLEANING]);
  });
});
