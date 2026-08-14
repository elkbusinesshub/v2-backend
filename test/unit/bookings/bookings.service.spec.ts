import { Test } from '@nestjs/testing';
import { BookingsService } from '@/modules/bookings/bookings.service';
import { UnifiedBookingsRepository } from '@/modules/bookings/unified-bookings.repository';

describe('BookingsService', () => {
  let bookingsService: BookingsService;
  let unified: jest.Mocked<UnifiedBookingsRepository>;

  beforeEach(async () => {
    unified = {
      findAllByUser: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<UnifiedBookingsRepository>;

    const moduleRef = await Test.createTestingModule({
      providers: [BookingsService, { provide: UnifiedBookingsRepository, useValue: unified }],
    }).compile();

    bookingsService = moduleRef.get(BookingsService);
  });

  describe('list', () => {
    it('maps every source onto one list shape, carrying the vertical through', async () => {
      unified.findAllByUser.mockResolvedValue([
        {
          id: 'ao-1',
          vertical: 'marketplace',
          reference: 'ELK-A-4T29K',
          serviceName: 'Deep Cleaning',
          serviceIcon: '✨',
          providerName: 'Royal Shine Cleaning Co.',
          status: 'NEW',
          scheduledAt: new Date('2026-07-08T10:00:00.000Z'),
          addressText: 'Koramangala',
          total: 149,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        },
        {
          id: 'rd-1',
          vertical: 'rides',
          reference: 'ELK-7781-QQ',
          serviceName: 'ELK Go ride',
          serviceIcon: '🚕',
          providerName: 'Suresh K.',
          status: 'CONFIRMED',
          scheduledAt: new Date('2026-07-07T10:00:00.000Z'),
          addressText: 'Indiranagar → MG Road',
          total: 210,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ]);

      const items = await bookingsService.list('u-1');

      // The app routes a cancel by this field, so it must survive the mapping.
      expect(items.map((i) => i.vertical)).toEqual(['marketplace', 'rides']);
      expect(items[0]).toEqual({
        id: 'ao-1',
        vertical: 'marketplace',
        reference: 'ELK-A-4T29K',
        serviceName: 'Deep Cleaning',
        serviceIcon: '✨',
        providerName: 'Royal Shine Cleaning Co.',
        status: 'NEW',
        scheduledAt: '2026-07-08T10:00:00.000Z',
        addressText: 'Koramangala',
        total: 149,
      });
    });

    it('serialises a booking with no schedule as a null date rather than crashing', async () => {
      unified.findAllByUser.mockResolvedValue([
        {
          id: 'po-1',
          vertical: 'porter',
          reference: 'ELK-4390-LX',
          serviceName: 'Bike delivery',
          serviceIcon: '📦',
          providerName: 'ELK Porter',
          status: 'CONFIRMED',
          scheduledAt: null, // "pickup now" carries no scheduled time
          addressText: 'Indiranagar → MG Road',
          total: 60,
          createdAt: new Date('2026-07-01T00:00:00.000Z'),
        },
      ]);

      const items = await bookingsService.list('u-1');
      expect(items[0]!.scheduledAt).toBeNull();
    });
  });
});
