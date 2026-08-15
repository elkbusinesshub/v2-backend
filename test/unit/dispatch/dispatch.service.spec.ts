import { Test } from '@nestjs/testing';
import { DriverService, DriverVerification, Role } from '@prisma/client';
import {
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
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
  licenceNumber: 'ka05 2011 0001234',
  licenceExpiry: yearsFromNow(5),
  licenceFrontKey: 'provider-docs/2026/front.jpg',
  licenceBackKey: 'provider-docs/2026/back.jpg',
  vehicleDocKey: 'provider-docs/2026/rc.jpg',
};

describe('DispatchService.register', () => {
  let service: DispatchService;
  let drivers: jest.Mocked<DispatchRepository>;

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
          },
        },
        { provide: DispatchGateway, useValue: {} },
        {
          provide: RideTypesRepository,
          useValue: {
            findActiveBySlug: jest
              .fn()
              .mockImplementation((slug: string) =>
                Promise.resolve(slug === 'auto' ? { slug: 'auto', emoji: '🛺' } : null),
              ),
          },
        },
        {
          provide: PorterCatalogRepository,
          useValue: { findActiveVehicleBySlug: jest.fn().mockResolvedValue({ slug: 'bike' }) },
        },
      ],
    }).compile();

    service = moduleRef.get(DispatchService);
    drivers = moduleRef.get(DispatchRepository);
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
