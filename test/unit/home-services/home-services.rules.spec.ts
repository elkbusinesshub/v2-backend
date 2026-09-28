import {
  applyPromo,
  matchArea,
  quote,
  todayInIndia,
  type PromoRule,
} from '@/modules/home-services/home-services.rules';

const price = { hourlyRate: 449, extraProRate: 399, materialsFee: 299 };

describe('quote', () => {
  it('charges the first professional the hourly rate and each extra one the extra rate', () => {
    // The admin panel's own example: 5 hrs × 2 pros of a full home deep clean.
    expect(quote(price, 5, 2, false)).toEqual({
      base: 449 * 5 + 399 * 5,
      materials: 0,
      subtotal: 4240,
    });
  });

  it('adds materials once per booking when asked for', () => {
    expect(quote(price, 5, 1, true)).toEqual({ base: 2245, materials: 299, subtotal: 2544 });
  });
});

describe('applyPromo', () => {
  const promo: PromoRule = {
    code: 'ONAM20',
    percent: 20,
    maxDiscount: 500,
    minOrder: 999,
    validTill: '2026-10-05',
    active: true,
  };
  const today = '2026-09-28';

  it('takes the percentage off', () => {
    expect(applyPromo(promo, 'onam20', 1000, today)).toMatchObject({ ok: true, discount: 200 });
  });

  it('stops at the cap', () => {
    expect(applyPromo(promo, 'ONAM20', 4240, today)).toMatchObject({
      ok: true,
      discount: 500,
      capped: true,
    });
  });

  it('has no cap when the cap is zero', () => {
    expect(applyPromo({ ...promo, maxDiscount: 0 }, 'ONAM20', 4240, today)).toMatchObject({
      discount: 848,
    });
  });

  it('says how much more is needed below the minimum order', () => {
    const result = applyPromo(promo, 'ONAM20', 900, today);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Add ₹99 more');
  });

  it('can still be used on its last day, not the day after', () => {
    expect(applyPromo(promo, 'ONAM20', 1000, '2026-10-05').ok).toBe(true);
    expect(applyPromo(promo, 'ONAM20', 1000, '2026-10-06').message).toContain('expired');
  });

  it('refuses a switched-off or unknown code', () => {
    expect(applyPromo({ ...promo, active: false }, 'ONAM20', 1000, today).ok).toBe(false);
    expect(applyPromo(null, 'nope', 1000, today).message).toBe("NOPE isn't a valid code.");
  });
});

describe('matchArea', () => {
  const kakkanad = { id: 'k', pincode: '682030', radiusKm: 6, lat: 10.0159, lng: 76.3419 };
  const edappally = { id: 'e', pincode: '682024', radiusKm: 5, lat: 10.0261, lng: 76.3125 };
  const unmapped = { id: 'u', pincode: '686001', radiusKm: 4, lat: null, lng: null };

  it('picks the nearest area whose radius covers the pin', () => {
    const area = matchArea([kakkanad, edappally], { text: '', lat: 10.027, lng: 76.31 });
    expect(area?.id).toBe('e');
  });

  it('falls back to a pincode in the address when no radius covers it', () => {
    const area = matchArea([kakkanad, unmapped], {
      text: 'Flat 2, Kottayam Town, Kerala 686001, India',
      lat: 9.59,
      lng: 76.52,
    });
    expect(area?.id).toBe('u');
  });

  it('serves nothing outside every area', () => {
    expect(
      matchArea([kakkanad], { text: 'Koramangala 560095', lat: 12.93, lng: 77.62 }),
    ).toBeNull();
  });
});

describe('todayInIndia', () => {
  it('is already tomorrow in India late in the UTC evening', () => {
    expect(todayInIndia(new Date('2026-09-28T20:00:00Z'))).toBe('2026-09-29');
  });
});
