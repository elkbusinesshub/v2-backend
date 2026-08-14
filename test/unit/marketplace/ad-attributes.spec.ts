import { type ErrorDetail, ValidationFailedException } from '@/common/errors/domain.exceptions';
import { validateAdAttributes } from '@/modules/marketplace/ad-attributes';

/** The messages a failure carries, so assertions can read them. */
function detailsOf(fn: () => unknown): ErrorDetail[] {
  try {
    fn();
  } catch (err) {
    if (err instanceof ValidationFailedException) {
      return err.details ?? [];
    }
    throw err;
  }
  throw new Error('expected validation to fail');
}

describe('validateAdAttributes', () => {
  describe('nothing to store', () => {
    it.each([undefined, null])('treats %p as no attributes', (raw) => {
      expect(validateAdAttributes('cleaning', raw)).toBeNull();
    });

    it('collapses an empty object to null', () => {
      // Otherwise `{}` and "not supplied" would persist differently, and the
      // column would fill with empty objects that mean nothing.
      expect(validateAdAttributes('cleaning', {})).toBeNull();
    });

    it('collapses an object of only cleared fields to null', () => {
      expect(validateAdAttributes('cleaning', { durationLabel: null })).toBeNull();
    });
  });

  describe('per category', () => {
    it('accepts cleaning details', () => {
      expect(
        validateAdAttributes('cleaning', {
          durationLabel: '2-3 hrs',
          includes: ['Sofa', 'Carpet'],
        }),
      ).toEqual({ durationLabel: '2-3 hrs', includes: ['Sofa', 'Carpet'] });
    });

    it('accepts car rental details', () => {
      expect(
        validateAdAttributes('car_rental', {
          seats: 5,
          transmission: 'AUTOMATIC',
          fuel: 'PETROL',
        }),
      ).toEqual({ seats: 5, transmission: 'AUTOMATIC', fuel: 'PETROL' });
    });

    it('accepts stay details', () => {
      expect(
        validateAdAttributes('elkstay', {
          roomType: 'Single room',
          stayType: 'PG',
          depositAmount: 15000,
          furnished: true,
        }),
      ).toEqual({
        roomType: 'Single room',
        stayType: 'PG',
        depositAmount: 15000,
        furnished: true,
      });
    });

    it('accepts a partially filled bag', () => {
      // A seller fills in what they know; nothing here is required.
      expect(validateAdAttributes('car_rental', { seats: 4 })).toEqual({ seats: 4 });
    });
  });

  describe('rejects what the category does not define', () => {
    it('refuses a key belonging to another category', () => {
      // Rental details on a cleaning ad would render as nothing at all.
      const details = detailsOf(() => validateAdAttributes('cleaning', { seats: 5 }));

      expect(details).toHaveLength(1);
      expect(details[0]!.field).toBe('attributes.seats');
      expect(details[0]!.message).toContain('unknown detail for cleaning');
    });

    it('refuses attributes on a category that takes none', () => {
      // Taxi and porter are still served by their own modules.
      const details = detailsOf(() => validateAdAttributes('taxi', { seats: 4 }));

      expect(details[0]!.message).toContain('takes no extra details');
    });

    it('allows an empty bag on a category that takes none', () => {
      expect(validateAdAttributes('taxi', {})).toBeNull();
    });

    it('refuses an unrecognised category outright', () => {
      const details = detailsOf(() => validateAdAttributes('nonsense', { seats: 4 }));

      expect(details[0]!.message).toContain('takes no extra details');
    });
  });

  describe('rejects malformed values', () => {
    it('refuses a non-object', () => {
      expect(detailsOf(() => validateAdAttributes('cleaning', 'text'))[0]!.message).toContain(
        'must be an object',
      );
      expect(detailsOf(() => validateAdAttributes('cleaning', [1, 2]))[0]!.message).toContain(
        'must be an object',
      );
    });

    it('refuses text where a number belongs', () => {
      expect(detailsOf(() => validateAdAttributes('car_rental', { seats: '5' }))[0]!.message).toBe(
        'must be a whole number',
      );
    });

    it('refuses a fractional seat count', () => {
      expect(detailsOf(() => validateAdAttributes('car_rental', { seats: 4.5 }))[0]!.message).toBe(
        'must be a whole number',
      );
    });

    it('refuses a number outside its range', () => {
      expect(
        detailsOf(() => validateAdAttributes('car_rental', { seats: 0 }))[0]!.message,
      ).toContain('between 1 and 60');
    });

    it('refuses a value outside a fixed set', () => {
      const details = detailsOf(() =>
        validateAdAttributes('car_rental', { transmission: 'SEMI_AUTO' }),
      );

      expect(details[0]!.message).toContain('MANUAL, AUTOMATIC');
    });

    it('refuses over-long text', () => {
      expect(
        detailsOf(() => validateAdAttributes('cleaning', { durationLabel: 'x'.repeat(41) }))[0]!
          .message,
      ).toContain('at most 40 characters');
    });

    it('refuses a list that is too long, and non-text entries', () => {
      expect(
        detailsOf(() => validateAdAttributes('cleaning', { includes: Array(13).fill('Sofa') }))[0]!
          .message,
      ).toContain('at most 12 entries');

      expect(
        detailsOf(() => validateAdAttributes('cleaning', { includes: ['Sofa', 7] }))[0]!.message,
      ).toContain('each entry must be text');
    });

    it('refuses a non-boolean where a flag belongs', () => {
      expect(
        detailsOf(() => validateAdAttributes('elkstay', { furnished: 'yes' }))[0]!.message,
      ).toBe('must be true or false');
    });

    it('reports every problem at once', () => {
      // A seller fixing a form should see the whole list, not one field per
      // round trip.
      const details = detailsOf(() =>
        validateAdAttributes('car_rental', { seats: 'five', transmission: 'X', fuel: 'COAL' }),
      );

      expect(details).toHaveLength(3);
    });
  });

  it('stores only recognised keys, never the raw object', () => {
    // Whatever a client sends reaches a JSON column; it must not arrive intact.
    const result = validateAdAttributes('car_rental', { seats: 5 });

    expect(Object.keys(result!)).toEqual(['seats']);
  });
});
