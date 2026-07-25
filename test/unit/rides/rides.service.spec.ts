import { Test } from '@nestjs/testing';
import { Prisma, RideBookingStatus, Role } from '@prisma/client';
import {
  DomainException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { LocationsRepository } from '@/modules/locations/locations.repository';
import { RideBookingsRepository } from '@/modules/rides/ride-bookings.repository';
import { RideTypesRepository } from '@/modules/rides/ride-types.repository';
import { RidesService } from '@/modules/rides/rides.service';

const user: AuthUser = { id: 'u-1', roles: [Role.USER], jti: 'j', exp: 9999999999 };

const auto = {
  id: 'rt-auto',
  slug: 'auto',
  name: 'Auto',
  emoji: '🛺',
  iconKey: 'car_auto',
  seats: 3,
  etaMinutes: 4,
  baseFare: new Prisma.Decimal(8),
  cancellationFee: new Prisma.Decimal(6),
  badge: 'FASTER',
  isActive: true,
  sortOrder: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const savedAddress = {
  id: 'addr-1',
  userId: 'u-1',
  label: 'Home',
  formattedAddress: 'Tower 3, Apt 1204, Al Reem Island',
  lat: 24.5,
  lng: 54.4,
  isDefault: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

describe('RidesService', () => {
  let service: RidesService;
  let rideTypes: jest.Mocked<RideTypesRepository>;
  let bookings: jest.Mocked<RideBookingsRepository>;
  let locations: jest.Mocked<LocationsRepository>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RidesService,
        {
          provide: RideTypesRepository,
          useValue: {
            listActive: jest.fn().mockResolvedValue([auto]),
            findActiveBySlug: jest.fn().mockResolvedValue(auto),
          },
        },
        {
          provide: RideBookingsRepository,
          useValue: {
            create: jest.fn().mockImplementation((booking) =>
              Promise.resolve({
                ...booking,
                id: 'b-1',
                rideType: auto,
                tipAmount: new Prisma.Decimal(0),
                ratingStars: null,
                startedAt: null,
                completedAt: null,
                cancelledAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
              }),
            ),
            listForUser: jest.fn().mockResolvedValue([]),
            findForUser: jest.fn(),
            start: jest.fn(),
            complete: jest.fn(),
            cancel: jest.fn(),
            rate: jest.fn(),
            codeExists: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: LocationsRepository,
          useValue: { findByIdForUser: jest.fn().mockResolvedValue(null) },
        },
      ],
    }).compile();

    service = moduleRef.get(RidesService);
    rideTypes = moduleRef.get(RideTypesRepository);
    bookings = moduleRef.get(RideBookingsRepository);
    locations = moduleRef.get(LocationsRepository);
  });

  describe('legacy contract', () => {
    it('lists ride types with the legacy id/emoji/name/price shape', async () => {
      const types = await service.listRideTypes();
      expect(types[0]).toMatchObject({ id: 'auto', emoji: '🛺', name: 'Auto', price: 8 });
    });

    it('serves a static current-estimate', () => {
      const estimate = service.getCurrentEstimate();
      expect(estimate).toMatchObject({ etaMinutes: 14, distanceKm: 8.2 });
    });

    it('previews a driver match without creating a booking', async () => {
      const match = await service.previewDriverMatch({ rideTypeId: 'auto' });
      expect(match).toHaveProperty('driverName');
      expect(match).toHaveProperty('plateNumber');
      expect(bookings.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown ride type on preview', async () => {
      rideTypes.findActiveBySlug.mockResolvedValue(null);
      await expect(service.previewDriverMatch({ rideTypeId: 'jet' })).rejects.toBeInstanceOf(
        ValidationFailedException,
      );
    });
  });

  describe('createBooking', () => {
    const dto = {
      rideTypeId: 'auto',
      pickupAddress: 'Dubai Marina · Gate 3',
      dropAddress: 'Downtown Dubai · Burj Khalifa',
      paymentMethod: 'cash',
    };

    it('books instantly with a driver, OTP, and mock payment', async () => {
      const booking = await service.createBooking(user, dto);
      expect(booking.code).toMatch(/^ELK-[A-Z0-9]{7}$/);
      expect(booking.status).toBe('confirmed');
      expect(booking.otpCode).toMatch(/^\d{4}$/);
      expect(booking.driver).toHaveProperty('name');
      const breakdown = booking.breakdown as Record<string, number>;
      expect(breakdown.totalAmount).toBe(8);
      expect(booking.paidAt).not.toBeNull();
    });

    it('rejects an unknown ride type', async () => {
      rideTypes.findActiveBySlug.mockResolvedValue(null);
      await expect(service.createBooking(user, dto)).rejects.toBeInstanceOf(
        ValidationFailedException,
      );
    });

    it('resolves a saved address id to its formatted text, overriding free text', async () => {
      locations.findByIdForUser.mockResolvedValue(savedAddress);
      const booking = await service.createBooking(user, {
        rideTypeId: 'auto',
        pickupAddressId: 'addr-1',
        dropAddress: 'Downtown Dubai · Burj Khalifa',
        paymentMethod: 'cash',
      });
      expect(booking.pickupAddress).toBe('Tower 3, Apt 1204, Al Reem Island');
    });

    it("404s when the saved address isn't the caller's", async () => {
      locations.findByIdForUser.mockResolvedValue(null);
      await expect(
        service.createBooking(user, {
          rideTypeId: 'auto',
          pickupAddressId: 'addr-x',
          dropAddress: 'Downtown Dubai · Burj Khalifa',
          paymentMethod: 'cash',
        }),
      ).rejects.toBeInstanceOf(ResourceNotFoundException);
    });
  });

  describe('lifecycle', () => {
    const owned = {
      id: 'b-1',
      code: 'ELK-ABC1234',
      otpCode: '8264',
      status: RideBookingStatus.CONFIRMED,
      rideType: auto,
      distanceKm: new Prisma.Decimal(8.2),
      etaMinutes: 4,
      fare: new Prisma.Decimal(8),
      cancellationFee: new Prisma.Decimal(6),
      tipAmount: new Prisma.Decimal(0),
      ratingStars: null,
      driverName: 'Farhan Ahmed',
      vehicleLabel: 'Toyota Corolla · White',
      plateNumber: 'DXB · B 22417',
      pickupAddress: 'Dubai Marina · Gate 3',
      dropAddress: 'Downtown Dubai · Burj Khalifa',
      paymentMethod: 'cash',
      paymentRef: 'PAY-ELK-ABC1234',
      paidAt: new Date(),
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('starts the trip when the OTP matches', async () => {
      bookings.findForUser.mockResolvedValue(owned as never);
      bookings.start.mockResolvedValue(true);
      await service.startRide(user, 'b-1', { otpCode: '8264' });
      expect(bookings.start).toHaveBeenCalledWith('b-1', user.id);
    });

    it('rejects an incorrect OTP without touching the booking', async () => {
      bookings.findForUser.mockResolvedValue(owned as never);
      await expect(service.startRide(user, 'b-1', { otpCode: '0000' })).rejects.toBeInstanceOf(
        ValidationFailedException,
      );
      expect(bookings.start).not.toHaveBeenCalled();
    });

    it('409s starting a trip that is not confirmed', async () => {
      bookings.findForUser.mockResolvedValue(owned as never);
      bookings.start.mockResolvedValue(false);
      await expect(service.startRide(user, 'b-1', { otpCode: '8264' })).rejects.toBeInstanceOf(
        DomainException,
      );
    });

    it('409s completing a trip that is not in progress', async () => {
      bookings.findForUser.mockResolvedValue(owned as never);
      bookings.complete.mockResolvedValue(false);
      await expect(service.completeRide(user, 'b-1')).rejects.toBeInstanceOf(DomainException);
    });

    it('409s cancelling once the trip has started', async () => {
      bookings.findForUser.mockResolvedValue(owned as never);
      bookings.cancel.mockResolvedValue(false);
      await expect(service.cancelBooking(user, 'b-1')).rejects.toMatchObject({
        code: 'NOT_CANCELLABLE',
      });
    });

    it('404s a foreign booking', async () => {
      bookings.findForUser.mockResolvedValue(null);
      await expect(service.getBooking(user, 'b-x')).rejects.toBeInstanceOf(
        ResourceNotFoundException,
      );
    });

    it('409s rating a ride twice', async () => {
      bookings.findForUser.mockResolvedValue(owned as never);
      bookings.rate.mockResolvedValue(false);
      await expect(service.rateRide(user, 'b-1', { stars: 5, tip: 5 })).rejects.toMatchObject({
        code: 'ALREADY_RATED',
      });
    });

    it('rates and tips once, on a completed ride', async () => {
      bookings.findForUser.mockResolvedValue(owned as never);
      bookings.rate.mockResolvedValue(true);
      await service.rateRide(user, 'b-1', { stars: 5, tip: 5 });
      expect(bookings.rate).toHaveBeenCalledWith('b-1', user.id, 5, 5);
    });
  });
});
