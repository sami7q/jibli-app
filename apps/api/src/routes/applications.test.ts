import { describe, expect, it } from 'vitest';
import { applySchema } from './applications.js';

/**
 * The public sign-up form: a shop applies as the kind it is, and is tagged
 * from that kind's own categories.
 */

const base = {
  display_name: 'كوزمتك الورد',
  applicant_name: 'رنا الوردي',
  applicant_phone: '07701234567',
  governorate_id: '0192f5a0-0000-7000-8000-000000000001',
  city_id: '0192f5a0-0000-7000-8000-000000000002',
  address_text: 'شارع ١٤ رمضان، المنصور',
};

describe('applying to join', () => {
  it('accepts a cosmetics shop with cosmetics categories', () => {
    const parsed = applySchema.parse({
      ...base,
      merchant_type: 'COSMETICS',
      cuisine_tags: ['cs_makeup'],
    });
    expect(parsed.merchant_type).toBe('COSMETICS');
  });

  it('accepts a market with its aisles', () => {
    expect(
      applySchema.safeParse({ ...base, merchant_type: 'MARKET', cuisine_tags: ['mk_dairy'] })
        .success,
    ).toBe(true);
  });

  it('refuses food categories on a cosmetics application', () => {
    expect(
      applySchema.safeParse({ ...base, merchant_type: 'COSMETICS', cuisine_tags: ['burger'] })
        .success,
    ).toBe(false);
  });

  it('still means a restaurant when an older form sends no type', () => {
    expect(applySchema.parse({ ...base, cuisine_tags: ['iraqi'] }).merchant_type).toBe(
      'RESTAURANT',
    );
  });
});
