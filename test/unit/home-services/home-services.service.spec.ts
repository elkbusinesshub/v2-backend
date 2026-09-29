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
                status: ServiceBookingStatus.PENDING,
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
      ],
    }).compile();
    svc = moduleRef.get(HomeServicesService);
    repo = moduleRef.get(HomeServicesRepository);
  });

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
    expect(booking.status).toBe(ServiceBookingStatus.PENDING);
    expect(booking.code).toMatch(/^ELK-S-[A-Z0-9]{5}$/);
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

  it('lets the customer cancel before the job starts, but not after', async () => {
    const row = { id: 'b-1', userId: 'u-1', status: ServiceBookingStatus.CONFIRMED };
    repo.findBooking.mockResolvedValue(row as never);
    repo.updateBooking.mockResolvedValue({
      ...row,
      status: ServiceBookingStatus.CANCELLED,
      scheduledDate: new Date(),
      createdAt: new Date(),
      user: { name: null },
      baseAmount: 0,
      materialsAmount: 0,
      discountAmount: 0,
      totalAmount: 0,
    } as never);
    await expect(svc.cancel(user, 'b-1')).resolves.toMatchObject({ status: 'CANCELLED' });

    repo.findBooking.mockResolvedValue({
      ...row,
      status: ServiceBookingStatus.IN_PROGRESS,
    } as never);
    await expect(svc.cancel(user, 'b-1')).rejects.toBeInstanceOf(DomainException);
  });

  it('does not let one customer cancel another’s booking', async () => {
    repo.findBooking.mockResolvedValue({ id: 'b-1', userId: 'someone-else' } as never);
    await expect(svc.cancel(user, 'b-1')).rejects.toBeInstanceOf(ResourceNotFoundException);
  });
});
