import { distanceKm, rentalDays } from '@/modules/service-requests/service-requests.service';

describe('service request helpers', () => {
  it('measures straight-line distance in km', () => {
    // Koramangala → Indiranagar is about 5 km.
    expect(distanceKm(12.9352, 77.6245, 12.9784, 77.6408)).toBeGreaterThan(4.5);
    expect(distanceKm(12.9352, 77.6245, 12.9784, 77.6408)).toBeLessThan(5.5);
    expect(distanceKm(12.97, 77.59, 12.97, 77.59)).toBe(0);
  });

  it('charges whole rental days, any part of a day counting, minimum one', () => {
    const start = new Date('2026-09-20T10:00:00Z');
    expect(rentalDays(start, new Date('2026-09-20T12:00:00Z'))).toBe(1);
    expect(rentalDays(start, new Date('2026-09-22T10:00:00Z'))).toBe(2);
    expect(rentalDays(start, new Date('2026-09-22T10:01:00Z'))).toBe(3);
  });
});
