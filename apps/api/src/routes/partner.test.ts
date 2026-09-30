import { describe, expect, it } from 'vitest';
import { isOpenApplication, partnerApplySchema } from './partner.js';

/**
 * Applying from the app, as the signed-in account: the shop's kind is stated,
 * never assumed, and one open application is enough.
 */

const base = {
  display_name: 'كوزمتك الورد',
  governorate_id: '0192f5a0-0000-7000-8000-000000000001',
  city_id: '0192f5a0-0000-7000-8000-000000000002',
  address_text: 'شارع ١٤ رمضان، المنصور',
};

describe('the in-app partner application', () => {
  it('accepts a cosmetics shop with cosmetics categories and a pin', () => {
    const parsed = partnerApplySchema.parse({
      ...base,
      merchant_type: 'COSMETICS',
      cuisine_tags: ['cs_makeup'],
      latitude: 33.3152,
      longitude: 44.3661,
    });
    expect(parsed.merchant_type).toBe('COSMETICS');
    expect(parsed.applicant_name).toBeUndefined();
  });

  it('accepts a market without categories', () => {
    expect(partnerApplySchema.safeParse({ ...base, merchant_type: 'MARKET' }).success).toBe(true);
  });

  it('never guesses the kind of shop', () => {
    // The public form defaults to a restaurant for old clients; this one has none.
    expect(partnerApplySchema.safeParse(base).success).toBe(false);
  });

  it('refuses a market tagged with food categories', () => {
    expect(
      partnerApplySchema.safeParse({ ...base, merchant_type: 'MARKET', cuisine_tags: ['burger'] })
        .success,
    ).toBe(false);
  });

  it('refuses an address too short to find', () => {
    expect(
      // Five letters is the floor; «بيت» is not an address anyone can drive to.
      partnerApplySchema.safeParse({ ...base, merchant_type: 'MARKET', address_text: 'بيت' })
        .success,
    ).toBe(false);
  });
});

describe('one open application at a time', () => {
  it('treats waiting states as open', () => {
    expect(isOpenApplication('UNDER_REVIEW')).toBe(true);
    expect(isOpenApplication('INFO_REQUESTED')).toBe(true);
    expect(isOpenApplication('DRAFT')).toBe(true);
  });

  it('lets a decided application be followed by a new one', () => {
    expect(isOpenApplication('APPROVED')).toBe(false);
    expect(isOpenApplication('REJECTED')).toBe(false);
  });
});
