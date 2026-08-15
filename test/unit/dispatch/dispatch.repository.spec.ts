import { Test } from '@nestjs/testing';
import { DriverService } from '@prisma/client';
import { PRISMA } from '@/database/prisma.constants';
import { DispatchRepository } from '@/modules/dispatch/dispatch.repository';

/**
 * These lock the `where` clause dispatch searches with.
 *
 * It is the one place work is handed out, so every rule about who may be
 * offered a job has to hold here or it can be walked around by staying online.
 */
describe('DispatchRepository.findNearby', () => {
  let repository: DispatchRepository;
  let findMany: jest.Mock;

  beforeEach(async () => {
    findMany = jest.fn().mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        DispatchRepository,
        { provide: PRISMA, useValue: { driverProfile: { findMany } } },
      ],
    }).compile();

    repository = moduleRef.get(DispatchRepository);
  });

  const origin = { lat: 12.9352, lng: 77.6245 };

  it('offers work only to partners whose licence is still in date', async () => {
    // A partner who went on duty yesterday with a licence expiring at midnight
    // stops being offered work this morning, without anything having to notice
    // and log them out.
    await repository.findNearby(DriverService.RIDE, origin, 7);

    const { where } = findMany.mock.calls[0][0];
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    expect(where.licenceExpiry).toEqual({ gte: startOfToday });
  });

  it('still filters on duty, freedom and a recent heartbeat', async () => {
    await repository.findNearby(DriverService.RIDE, origin, 7);

    const { where } = findMany.mock.calls[0][0];
    expect(where).toMatchObject({
      service: DriverService.RIDE,
      isOnline: true,
      activeBookingId: null,
    });
    expect(where.lastSeenAt.gte).toBeInstanceOf(Date);
  });

  it('narrows to one vehicle class when asked', async () => {
    await repository.findNearby(DriverService.PORTER, origin, 7, { vehicleSlug: 'bike' });

    const { where } = findMany.mock.calls[0][0];
    expect(where.vehicleSlug).toBe('bike');
  });
});
