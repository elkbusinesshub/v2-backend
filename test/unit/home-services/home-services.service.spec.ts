import { Test } from '@nestjs/testing';
import { UserType, ServiceBookingStatus, ServiceVertical } from '@prisma/client';
import {
  DomainException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { HomeServicesRepository } from '@/modules/home-services/home-services.repository';
import { HomeServicesService } from '@/modules/home-services/home-services.service';
import { LocationsRepository } from '@/modules/locations/locations.repository';
import { RazorpayService } from '@/modules/razorpay/razorpay.service';
import { UsersRepository } from '@/modules/users/users.repository';

const user: AuthUser = { id: 'u-1', role: UserType.USER, jti: 'j', exp: 9999999999 };
const FUTURE = '2099-01-10';

const service = {
  id: 's-1',
  vertical: ServiceVertical.CLEANING,
  category: 'bth',
  name: 'Bathroom deep clean',
  description: '',
  minHours: 2,
  hourlyRate: 349 as never,
  extraProRate: 299 as never,
  materialsFee: 149 as never,
  active: true,
  online: true,
  approved: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const address = {
  id: 'a-1',
  userId: 'u-1',
  label: 'Home',
  formattedAddress: 'Kakkanad, Kochi, Kerala 682030, India',
  lat: 10.016,
  lng: 76.342,
  isDefault: true,
  building: 'Skyline Ivy League',
  flatNumber: '4B',
  directions: 'Gate 2',
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

const area = {
  id: 'loc-1',
  area: 'Kakkanad',
  district: 'Ernakulam',
  pincode: '682030',
  radiusKm: 6,
  lat: 10.0159,
  lng: 76.3419,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const checkout = { keyId: 'rzp_test_x', orderId: 'order_1', amount: 194400, currency: 'INR' };
const HOUR = 3_600_000;

const base = {
  serviceId: 's-1',
  hours: 3,
  professionals: 2,
  date: FUTURE,
  timeSlot: '10:00',
  addressId: 'a-1',
};

describe('HomeServicesService', () => {
  let svc: HomeServicesService;
  let repo: jest.Mocked<HomeServicesRepository>;
  let razorpay: jest.Mocked<RazorpayService>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HomeServicesService,
        {
          provide: HomeServicesRepository,
          useValue: {
            listLive: jest.fn().mockResolvedValue([service]),
            findService: jest.fn().mockResolvedValue(service),
            findPromo: jest.fn().mockResolvedValue(null),
            activeAreas: jest.fn().mockResolvedValue([area]),
            createBooking: jest.fn().mockImplementation((data) =>
              Promise.resolve({
                ...data,
                id: 'b-1',
                createdAt: new Date(),
                user: { name: 'Anjali' },
                location: null,
                professional: null,
                promoCode: data.promoCode ?? null,
                directions: data.directions ?? null,
                lat: data.lat ?? null,
                lng: data.lng ?? null,
              }),
            ),
            findBooking: jest.fn(),
            updateBooking: jest.fn(),
            cancelBooking: jest.fn(),
          },
        },
        {
          provide: LocationsRepository,
          useValue: { findByIdForUser: jest.fn().mockResolvedValue(address) },
        },
        {
          provide: UsersRepository,
          useValue: { findById: jest.fn().mockResolvedValue({ phone: '+919000000001' }) },
        },
        {
          provide: RazorpayService,
          useValue: {
            enabled: true,
            checkout: jest.fn().mockResolvedValue(checkout),
            verify: jest.fn().mockResolvedValue(undefined),
            refund: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();
    svc = moduleRef.get(HomeServicesService);
    repo = moduleRef.get(HomeServicesRepository);
    razorpay = moduleRef.get(RazorpayService);
  });

  /** A booking of [total] made [hoursAgo] hours ago, and what cancelling it returns. */
  function cancellable(paymentMethod: string, total: number, hoursAgo: number) {
    const row = {
      id: 'b-1',
      userId: 'u-1',
      status: ServiceBookingStatus.CONFIRMED,
      totalAmount: total,
      createdAt: new Date(Date.now() - hoursAgo * HOUR),
    };
    repo.findBooking.mockResolvedValue(row as never);
    repo.cancelBooking.mockImplementation((_id, _from, fee) =>
      Promise.resolve({
        ...row,
        status: ServiceBookingStatus.CANCELLED,
        paymentMethod,
        serviceName: 'Bathroom deep clean',
        scheduledDate: new Date(),
        user: { name: null },
        baseAmount: 0,
        materialsAmount: 0,
        discountAmount: 0,
        cancellationFee: fee ?? 0,
      } as never),
    );
  }

  it('prices a booking from the stored rates and files it under the matching area', async () => {
    const booking = await svc.book(user, { ...base, withMaterials: true });

    expect(repo.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        baseAmount: 349 * 3 + 299 * 3,
        materialsAmount: 149,
        discountAmount: 0,
        totalAmount: 2093,
        locationId: 'loc-1',
        addressText: '4B, Skyline Ivy League, Kakkanad, Kochi, Kerala 682030, India',
        directions: 'Gate 2',
        contactPhone: '+919000000001',
      }),
    );
    expect(booking.code).toMatch(/^ELK-S-[A-Z0-9]{5}$/);
  });

  it('holds a Razorpay booking back from the admin until it is paid, and returns the checkout', async () => {
    const booking = await svc.book(user, base);

    expect(repo.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ServiceBookingStatus.AWAITING_PAYMENT,
        paymentMethod: 'razorpay',
      }),
    );
    expect(razorpay.checkout).toHaveBeenCalledWith({
      id: 'b-1',
      code: booking.code,
      total: 1944,
    });
    expect(booking.checkout).toEqual(checkout);
  });

  it('places a booking a promo made free at once, with nothing for Razorpay to collect', async () => {
    repo.findPromo.mockResolvedValue({
      id: 'p',
      code: 'FREE100',
      percent: 100,
      maxDiscount: 100000 as never,
      minOrder: 0 as never,
      validTill: new Date('2099-12-31T00:00:00Z'),
      active: true,
      description: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const booking = await svc.book(user, { ...base, promoCode: 'FREE100' });

    expect(repo.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ status: ServiceBookingStatus.PENDING, totalAmount: 0 }),
    );
    expect(razorpay.checkout).not.toHaveBeenCalled();
    expect(booking.checkout).toBeNull();
  });

  it('closes the booking when Razorpay cannot open an order', async () => {
    razorpay.checkout.mockRejectedValueOnce(new Error('razorpay down'));
    await expect(svc.book(user, base)).rejects.toThrow('razorpay down');
    expect(repo.cancelBooking).toHaveBeenCalledWith('b-1', [ServiceBookingStatus.AWAITING_PAYMENT]);
  });

  it('refuses a Razorpay booking while Razorpay is switched off, before saving anything', async () => {
    Object.assign(razorpay, { enabled: false });
    await expect(svc.book(user, base)).rejects.toMatchObject({ code: 'PAYMENTS_UNAVAILABLE' });
    expect(repo.createBooking).not.toHaveBeenCalled();
  });

  it('confirms only the customer’s own booking with the checkout result', async () => {
    const dto = { razorpayOrderId: 'order_1', razorpayPaymentId: 'pay_1', razorpaySignature: 'a' };
    repo.findBooking.mockResolvedValue({ id: 'b-1', userId: 'someone-else' } as never);
    await expect(svc.verifyPayment(user, 'b-1', dto)).rejects.toBeInstanceOf(
      ResourceNotFoundException,
    );
    expect(razorpay.verify).not.toHaveBeenCalled();
  });

  it('ignores a materials request on a service that offers none', async () => {
    repo.findService.mockResolvedValue({ ...service, materialsFee: 0 as never });
    await svc.book(user, { ...base, withMaterials: true });
    expect(repo.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ withMaterials: false, materialsAmount: 0 }),
    );
  });

  it('takes a valid promo code off the total', async () => {
    repo.findPromo.mockResolvedValue({
      id: 'p',
      code: 'WELCOME15',
      percent: 15,
      maxDiscount: 300 as never,
      minOrder: 499 as never,
      validTill: new Date('2099-12-31T00:00:00Z'),
      active: true,
      description: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await svc.book(user, { ...base, promoCode: 'welcome15' });
    expect(repo.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        discountAmount: 292,
        totalAmount: 1944 - 292,
        promoCode: 'WELCOME15',
      }),
    );
  });

  it('refuses the booking when the promo code does not apply, rather than dropping it silently', async () => {
    await expect(svc.book(user, { ...base, promoCode: 'NOPE' })).rejects.toBeInstanceOf(
      DomainException,
    );
    expect(repo.createBooking).not.toHaveBeenCalled();
  });

  it('refuses an address no service area covers', async () => {
    repo.activeAreas.mockResolvedValue([]);
    await expect(svc.book(user, base)).rejects.toMatchObject({ code: 'AREA_NOT_SERVED' });
  });

  it('refuses fewer hours than the service needs', async () => {
    await expect(svc.book(user, { ...base, hours: 1 })).rejects.toBeInstanceOf(
      ValidationFailedException,
    );
  });

  it('treats a service that is offline as missing', async () => {
    repo.findService.mockResolvedValue({ ...service, online: false });
    await expect(svc.book(user, base)).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  it('treats a new service the super admin has not approved as missing', async () => {
    repo.findService.mockResolvedValue({ ...service, approved: false });
    await expect(svc.book(user, base)).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  it('lets the customer cancel before the job starts, but not after', async () => {
    cancellable('razorpay', 0, 0);
    await expect(svc.cancel(user, 'b-1')).resolves.toMatchObject({ status: 'CANCELLED' });

    repo.findBooking.mockResolvedValue({
      id: 'b-1',
      userId: 'u-1',
      status: ServiceBookingStatus.IN_PROGRESS,
    } as never);
    await expect(svc.cancel(user, 'b-1')).rejects.toBeInstanceOf(DomainException);
  });

  it('refunds a Razorpay booking in full when cancelled within 2 hours of booking', async () => {
    cancellable('razorpay', 1944, 1.5);
    const cancelled = await svc.cancel(user, 'b-1');
    expect(repo.cancelBooking).toHaveBeenCalledWith('b-1', expect.any(Array), 0);
    expect(razorpay.refund).toHaveBeenCalledWith('b-1', 1944);
    expect(cancelled.cancellationFee).toBe(0);
  });

  it('keeps 10% of a Razorpay booking cancelled more than 2 hours after booking', async () => {
    cancellable('razorpay', 1944, 3);
    const cancelled = await svc.cancel(user, 'b-1');
    expect(repo.cancelBooking).toHaveBeenCalledWith('b-1', expect.any(Array), 194.4);
    expect(razorpay.refund).toHaveBeenCalledWith('b-1', 1944 - 194.4);
    expect(cancelled.cancellationFee).toBe(194.4);
  });

  it('does not let one customer cancel another’s booking', async () => {
    repo.findBooking.mockResolvedValue({ id: 'b-1', userId: 'someone-else' } as never);
    await expect(svc.cancel(user, 'b-1')).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  it('refunds a cancelled booking once', async () => {
    cancellable('razorpay', 1944, 0);
    await svc.cancel(user, 'b-1');
    expect(razorpay.refund).toHaveBeenCalledWith('b-1', 1944);

    // A second cancel that loses the race refunds nothing.
    razorpay.refund.mockClear();
    repo.cancelBooking.mockReset();
    repo.cancelBooking.mockResolvedValue(null);
    await expect(svc.cancel(user, 'b-1')).rejects.toBeInstanceOf(DomainException);
    expect(razorpay.refund).not.toHaveBeenCalled();
  });
});
