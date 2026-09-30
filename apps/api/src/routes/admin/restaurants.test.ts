import { describe, expect, it } from 'vitest';
import { createMerchantSchema, tagsForMerchantType } from './restaurants.js';

/**
 * The one rule the create route adds for three sections: a merchant is tagged
 * from its own section's vocabulary. Everything else about creating a cosmetics
 * shop is the restaurant path unchanged.
 */

const base = {
  display_name: 'كوزمتك الورد',
  owner_phone: '07701234567',
  owner_name: 'رنا الوردي',
  governorate_id: '0192f5a0-0000-7000-8000-000000000001',
  city_id: '0192f5a0-0000-7000-8000-000000000002',
  address_text: 'شارع ١٤ رمضان، المنصور',
};

describe('creating a merchant', () => {
  it('accepts a cosmetics shop tagged with cosmetics aisles', () => {
    const parsed = createMerchantSchema.parse({
      ...base,
      merchant_type: 'COSMETICS',
      cuisine_tags: ['cs_makeup', 'cs_skincare'],
    });
    expect(parsed.merchant_type).toBe('COSMETICS');
    expect(parsed.cuisine_tags).toEqual(['cs_makeup', 'cs_skincare']);
  });

  it('refuses a food cuisine on a cosmetics shop', () => {
    const result = createMerchantSchema.safeParse({
      ...base,
      merchant_type: 'COSMETICS',
      cuisine_tags: ['burger'],
    });
    expect(result.success).toBe(false);
  });

  it('refuses a cosmetics aisle on a restaurant', () => {
    const result = createMerchantSchema.safeParse({ ...base, cuisine_tags: ['cs_makeup'] });
    expect(result.success).toBe(false);
  });

  it('still defaults to a restaurant with food cuisines, as callers before markets expect', () => {
    const parsed = createMerchantSchema.parse({ ...base, cuisine_tags: ['iraqi'] });
    expect(parsed.merchant_type).toBe('RESTAURANT');
  });

  it('accepts a market tagged with its aisles', () => {
    expect(
      createMerchantSchema.safeParse({
        ...base,
        merchant_type: 'MARKET',
        cuisine_tags: ['mk_dairy'],
      }).success,
    ).toBe(true);
  });
});

/**
 * What happens to a shop's tags when it changes section.
 *
 * The create route refuses tags from the wrong section; the correction route
 * cannot, because the shop already carries them. It keeps what fits and says
 * what it dropped, and the two lists together are exactly the input.
 */
describe('moving a shop to another section', () => {
  it('keeps the tags that exist in the new section and drops the rest', () => {
    const { kept, dropped } = tagsForMerchantType(['burger', 'mk_dairy', 'pizza'], 'MARKET');
    expect(kept).toEqual(['mk_dairy']);
    expect(dropped).toEqual(['burger', 'pizza']);
  });

  it('drops nothing from a shop already tagged for the section', () => {
    const { kept, dropped } = tagsForMerchantType(['cs_makeup', 'cs_skincare'], 'COSMETICS');
    expect(kept).toEqual(['cs_makeup', 'cs_skincare']);
    expect(dropped).toEqual([]);
  });

  it('leaves an untagged shop untagged', () => {
    expect(tagsForMerchantType([], 'RESTAURANT')).toEqual({ kept: [], dropped: [] });
  });
});
