import { Test } from '@nestjs/testing';
import { DriverService, DriverVerification, Gender, Role } from '@prisma/client';
import {
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { DomainException } from '@/common/errors/domain.exceptions';
import { DispatchGateway } from '@/modules/dispatch/dispatch.gateway';
import { DispatchRepository } from '@/modules/dispatch/dispatch.repository';
import { DispatchService } from '@/modules/dispatch/dispatch.service';
import { PorterCatalogRepository } from '@/modules/porter/porter-catalog.repository';
import { RideTypesRepository } from '@/modules/rides/ride-types.repository';

const user: AuthUser = { id: 'u-1', roles: [Role.USER], jti: 'j', exp: 9999999999 };

/** Today, shifted by whole years — negative goes back. */
function yearsFromNow(years: number): string {
  const at = new Date();
  at.setFullYear(at.getFullYear() + years);
  return at.toISOString().slice(0, 10);
}

const yearsAgo = (years: number): string => yearsFromNow(-years);

/** A registration as the app sends it, once the three uploads have returned. */
const registration = {
  service: DriverService.RIDE,
  vehicleSlug: 'auto',
  vehicleLabel: 'Bajaj RE · Yellow',
  plateNumber: 'ka05ta1111',
  fullName: '  Ravi Kumar  ',
  dateOfBirth: '1992-04-17',
  gender: Gender.MALE,
  licenceNumber: 'ka05 2011 0001234',
  licenceExpiry: yearsFromNow(5),
  licenceFrontKey: 'provider-docs/2026/front.jpg',
  licenceBackKey: 'provider-docs/2026/back.jpg',
  vehicleDocKey: 'provider-docs/2026/rc.jpg',
};

/** A stored profile, as the repository hands it back. */
function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dp-1',
    userId: 'u-1',
    service: DriverService.RIDE,
    vehicleSlug: 'auto',
    vehicleLabel: 'Bajaj RE · Yellow',
    plateNumber: 'KA05TA1111',
    fullName: 'Ravi Kumar',
    dateOfBirth: new Date('1992-04-17'),
    gender: Gender.MALE,
    licenceNumber: 'KA0520110001234',
    licenceExpiry: new Date(yearsFromNow(5)),
    licenceFrontKey: 'k1',
    licenceBackKey: 'k2',
    vehicleDocKey: 'k3',
    verification: DriverVerification.VERIFIED,
    isOnline: false,
    lat: null,
    lng: null,
    lastSeenAt: null,
    activeBookingId: null,
    ...overrides,
  };
}

describe('DispatchService.register', () => {
  let service: DispatchService;
  let drivers: jest.Mocked<DispatchRepository>;
  let gateway: jest.Mocked<DispatchGateway>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DispatchService,
        {
          provide: DispatchRepository,
          useValue: {
            // Echoes what it was asked to store, so a test can see what the
            // service actually wrote rather than a fixture.
            upsertProfile: jest.fn().mockImplementation((userId, svc, data) =>
              Promise.resolve({
                id: 'dp-1',
                userId,
                service: svc,
                isOnline: false,
                lat: null,
                lng: null,
                lastSeenAt: null,
                activeBookingId: null,
                ...data,
              }),
            ),
            findProfile: jest.fn().mockResolvedValue({
              id: 'dp-1',
              service: DriverService.RIDE,
              activeBookingId: null,
            }),
            findProfilesForUser: jest
              .fn()
              .mockResolvedValue([
                { id: 'dp-1', service: DriverService.RIDE, activeBookingId: null },
              ]),
            update: jest.fn().mockImplementation((id, data) => Promise.resolve({ id, ...data })),
          },
        },
        {
          provide: DispatchGateway,
          useValue: {
            emitDriverPosition: jest.fn(),
            emitVehicleMoved: jest.fn(),
            emitVehicleGone: jest.fn(),
          },
        },
        {
          provide: RideTypesRepository,
          useValue: {
            listActive: jest.fn().mockResolvedValue([{ slug: 'auto', emoji: '🛺', etaMinutes: 3 }]),
            findActiveBySlug: jest
              .fn()
              .mockImplementation((slug: string) =>
                Promise.resolve(slug === 'auto' ? { slug: 'auto', emoji: '🛺' } : null),
              ),
          },
        },
        {
          provide: PorterCatalogRepository,
          useValue: {
            findActiveVehicleBySlug: jest.fn().mockResolvedValue({ slug: 'bike' }),
            listActiveVehicles: jest
              .fn()
              .mockResolvedValue([{ slug: 'bike', emoji: '🏍️', etaMinutes: 4 }]),
          },
        },
      ],
    }).compile();

    service = moduleRef.get(DispatchService);
    drivers = moduleRef.get(DispatchRepository);
    gateway = moduleRef.get(DispatchGateway);
  });

  it('stores the identity and the three document keys', async () => {
    // The whole point of the change: a name and a plate said nothing about the
    // person a rider is about to get into a car with.
    await service.register(user, registration);

    expect(drivers.upsertProfile).toHaveBeenCalledWith(
      'u-1',
      DriverService.RIDE,
      expect.objectContaining({
        fullName: 'Ravi Kumar',
        licenceFrontKey: 'provider-docs/2026/front.jpg',
        licenceBackKey: 'provider-docs/2026/back.jpg',
        vehicleDocKey: 'provider-docs/2026/rc.jpg',
      }),
    );
  });

  describe('live vehicles on the rider map', () => {
    it('puts a free partner on duty onto the map as they move', async () => {
      drivers.findProfilesForUser.mockResolvedValue([
        profile({ id: 'dp-1', isOnline: true, activeBookingId: null }),
      ] as never);

      await service.updateLocation(user, { lat: 12.93, lng: 77.62 });

      expect(gateway.emitVehicleMoved).toHaveBeenCalledWith(
        DriverService.RIDE,
        12.93,
        77.62,
        expect.objectContaining({ id: 'dp-1', vehicleSlug: 'auto', lat: 12.93, lng: 77.62 }),
      );
    });

    it('does not draw a partner who is off duty', async () => {
      // The condition mirrors findNearby's: somebody who would not be offered
      // work must not appear to be waiting for it.
      drivers.findProfilesForUser.mockResolvedValue([
        profile({ id: 'dp-1', isOnline: false, activeBookingId: null }),
      ] as never);

      await service.updateLocation(user, { lat: 12.93, lng: 77.62 });

      expect(gateway.emitVehicleMoved).not.toHaveBeenCalled();
    });

    it('does not draw a partner already on a job', async () => {
      drivers.findProfilesForUser.mockResolvedValue([
        profile({ id: 'dp-1', isOnline: true, activeBookingId: 'b-1' }),
      ] as never);

      await service.updateLocation(user, { lat: 12.93, lng: 77.62 });

      expect(gateway.emitVehicleMoved).not.toHaveBeenCalled();
      // The rider on that trip still follows them.
      expect(gateway.emitDriverPosition).toHaveBeenCalledWith('b-1', 12.93, 77.62);
    });
  });

  describe('updateLocation', () => {
    it('updates the named service when the heartbeat says which', async () => {
      await service.updateLocation(user, {
        service: DriverService.RIDE,
        lat: 12.9352,
        lng: 77.6245,
      });

      expect(drivers.update).toHaveBeenCalledWith(
        'dp-1',
        expect.objectContaining({ lat: 12.9352, lng: 77.6245 }),
      );
    });

    it('updates every registration when no service is named', async () => {
      // What the app sends when it opens: here is where this account is, for
      // whatever it drives for.
      drivers.findProfilesForUser.mockResolvedValue([
        profile({ id: 'dp-ride', service: DriverService.RIDE }),
        profile({ id: 'dp-porter', service: DriverService.PORTER }),
      ] as never);

      const result = await service.updateLocation(user, { lat: 12.9, lng: 77.6 });

      expect(result).toEqual({ ok: true, updated: 2 });
      expect(drivers.update).toHaveBeenCalledTimes(2);
    });

    it('is quiet for an account that drives for nothing', async () => {
      // Every user's app calls this on open, and almost none are partners —
      // so nothing to update is a result, not an error.
      drivers.findProfilesForUser.mockResolvedValue([]);

      await expect(service.updateLocation(user, { lat: 12.9, lng: 77.6 })).resolves.toEqual({
        ok: true,
        updated: 0,
      });
      expect(drivers.update).not.toHaveBeenCalled();
    });
  });

  it('stores the gender the partner declared', async () => {
    // Checked against the licence during review, so it has to be held rather
    // than merely asked for.
    await service.register(user, { ...registration, gender: Gender.FEMALE });

    expect(drivers.upsertProfile).toHaveBeenCalledWith(
      'u-1',
      DriverService.RIDE,
      expect.objectContaining({ gender: Gender.FEMALE }),
    );
  });

  it('gives the partner their gender back on their own profile', async () => {
    const result = await service.register(user, registration);

    expect(result.gender).toBe(Gender.MALE);
  });

  it('normalises the plate and the licence number', async () => {
    // Typed by somebody on a phone: spacing and case are theirs, the stored
    // form is ours, or two records of one licence never match.
    await service.register(user, registration);

    const [, , stored] = drivers.upsertProfile.mock.calls[0]!;
    expect(stored).toMatchObject({
      plateNumber: 'KA05TA1111',
      licenceNumber: 'KA0520110001234',
    });
  });

  it('lands as PENDING, whatever it was before', async () => {
    await service.register(user, registration);

    const [, , stored] = drivers.upsertProfile.mock.calls[0]!;
    expect(stored).toMatchObject({ verification: DriverVerification.PENDING });
  });

  it('re-registering with new documents needs checking again', async () => {
    // Somebody who swaps their licence photographs has not been verified
    // against the new ones; carrying the flag over would make it meaningless.
    await service.register(user, {
      ...registration,
      licenceFrontKey: 'provider-docs/2026/new-front.jpg',
    });

    const [, , stored] = drivers.upsertProfile.mock.calls[0]!;
    expect(stored).toMatchObject({ verification: DriverVerification.PENDING });
  });

  it('refuses somebody too young to hold a licence', async () => {
    await expect(
      service.register(user, { ...registration, dateOfBirth: yearsAgo(16) }),
    ).rejects.toBeInstanceOf(ValidationFailedException);
    expect(drivers.upsertProfile).not.toHaveBeenCalled();
  });

  it('accepts somebody who has just turned eighteen', async () => {
    await expect(
      service.register(user, { ...registration, dateOfBirth: yearsAgo(19) }),
    ).resolves.toBeDefined();
  });

  it('refuses a birth date in the future', async () => {
    // A date string is not a possible date: the validator accepts tomorrow.
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    await expect(
      service.register(user, { ...registration, dateOfBirth: tomorrow }),
    ).rejects.toBeInstanceOf(ValidationFailedException);
  });

  it('refuses a birth date nobody could have', async () => {
    await expect(
      service.register(user, { ...registration, dateOfBirth: '1850-01-01' }),
    ).rejects.toBeInstanceOf(ValidationFailedException);
  });

  it('refuses a licence that has already expired', async () => {
    // The reason for asking at all: a document that stopped being valid last
    // year proves nothing, and storing it as though it did leaves the check to
    // nobody.
    await expect(
      service.register(user, { ...registration, licenceExpiry: yearsAgo(1) }),
    ).rejects.toBeInstanceOf(ValidationFailedException);
    expect(drivers.upsertProfile).not.toHaveBeenCalled();
  });

  it('refuses a licence dated absurdly far ahead', async () => {
    await expect(
      service.register(user, { ...registration, licenceExpiry: yearsFromNow(60) }),
    ).rejects.toBeInstanceOf(ValidationFailedException);
  });

  it('stores an expiry that is still in the future', async () => {
    await service.register(user, { ...registration, licenceExpiry: yearsFromNow(3) });

    const [, , stored] = drivers.upsertProfile.mock.calls[0]!;
    expect(stored.licenceExpiry).toBeInstanceOf(Date);
  });

  it('still refuses a vehicle class dispatch never searches for', async () => {
    await expect(
      service.register(user, { ...registration, vehicleSlug: 'hovercraft' }),
    ).rejects.toBeInstanceOf(ResourceNotFoundException);
  });

  it('does not hand the document keys back to the app', async () => {
    // The partner has no use for them and a key is one step from the file.
    const profile = await service.register(user, registration);

    expect(profile).toMatchObject({
      fullName: 'Ravi Kumar',
      verification: DriverVerification.PENDING,
      hasDocuments: true,
    });
    expect(profile).not.toHaveProperty('licenceFrontKey');
    expect(profile).not.toHaveProperty('vehicleDocKey');
  });
});

describe('DispatchService.setOnline', () => {
  let service: DispatchService;
  let drivers: jest.Mocked<DispatchRepository>;

  /** Builds the service around one stored profile. */
  async function build(stored: ReturnType<typeof profile>) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DispatchService,
        {
          provide: DispatchRepository,
          useValue: {
            findProfile: jest.fn().mockResolvedValue({ ...stored, user: { name: 'Ravi K' } }),
            findProfilesForUser: jest.fn().mockResolvedValue([stored]),
            update: jest
              .fn()
              .mockImplementation((_id, data) => Promise.resolve({ ...stored, ...data })),
          },
        },
        { provide: DispatchGateway, useValue: {} },
        { provide: RideTypesRepository, useValue: {} },
        { provide: PorterCatalogRepository, useValue: {} },
      ],
    }).compile();
    service = moduleRef.get(DispatchService);
    drivers = moduleRef.get(DispatchRepository);
  }

  const goOnline = { service: DriverService.RIDE, isOnline: true };

  it('lets a partner with a current licence go on duty', async () => {
    await build(profile());

    const result = await service.setOnline(user, goOnline);

    expect(result).toMatchObject({ isOnline: true });
  });

  it('refuses duty once the licence has run out', async () => {
    // Dispatch already skips them; without this they would sit online all day
    // being offered nothing and never learn why.
    await build(profile({ licenceExpiry: new Date(yearsAgo(1)) }));

    await expect(service.setOnline(user, goOnline)).rejects.toBeInstanceOf(DomainException);
    expect(drivers.update).not.toHaveBeenCalled();
  });

  it('counts a licence expiring today as still valid', async () => {
    // Valid *through* the day it expires — cutting somebody off at whatever
    // time the column holds would be arbitrary.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await build(profile({ licenceExpiry: today }));

    await expect(service.setOnline(user, goOnline)).resolves.toMatchObject({ isOnline: true });
  });

  it('refuses duty to a profile with no licence on file', async () => {
    // Registered before documents were required: it has proved nothing.
    await build(profile({ licenceExpiry: null }));

    await expect(service.setOnline(user, goOnline)).rejects.toBeInstanceOf(DomainException);
  });

  it('still lets an expired partner go off duty', async () => {
    // Refusing this would strand somebody online with no way back.
    await build(profile({ licenceExpiry: new Date(yearsAgo(1)), isOnline: true }));

    await expect(
      service.setOnline(user, { service: DriverService.RIDE, isOnline: false }),
    ).resolves.toMatchObject({ isOnline: false });
  });
});
