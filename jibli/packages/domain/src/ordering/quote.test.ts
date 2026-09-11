import { describe, expect, it } from 'vitest';
import { expectAppError } from '@jibli/test-utils';
import {
  assertQuoteUnchanged,
  buildQuote,
  resolveCommissionRate,
  type CatalogItem,
} from './quote.js';

const sizeGroup = {
  id: 'g-size',
  nameAr: 'الحجم',
  minSelect: 1,
  maxSelect: 1,
  isRequired: true,
  isActive: true,
  modifiers: [
    { id: 'm-small', groupId: 'g-size', nameAr: 'صغير', priceIqd: 0, isAvailable: true },
    { id: 'm-large', groupId: 'g-size', nameAr: 'كبير', priceIqd: 2_000, isAvailable: true },
  ],
};

const extrasGroup = {
  id: 'g-extras',
  nameAr: 'إضافات',
  minSelect: 0,
  maxSelect: 2,
  isRequired: false,
  isActive: true,
  modifiers: [
    { id: 'm-cheese', groupId: 'g-extras', nameAr: 'جبن إضافي', priceIqd: 500, isAvailable: true },
    { id: 'm-sauce', groupId: 'g-extras', nameAr: 'صلصة', priceIqd: 250, isAvailable: true },
    { id: 'm-olives', groupId: 'g-extras', nameAr: 'زيتون', priceIqd: 300, isAvailable: false },
  ],
};

const kebab: CatalogItem = {
  id: 'item-kebab',
  restaurantId: 'rest-1',
  nameAr: 'كباب عراقي',
  basePriceIqd: 12_000,
  costPriceIqd: 7_000,
  isActive: true,
  isAvailable: true,
  modifierGroups: [sizeGroup, extrasGroup],
};

const dolma: CatalogItem = {
  id: 'item-dolma',
  restaurantId: 'rest-1',
  nameAr: 'دولمة',
  basePriceIqd: 6_000,
  costPriceIqd: null,
  isActive: true,
  isAvailable: true,
  modifierGroups: [],
};

const catalog = new Map([
  [kebab.id, kebab],
  [dolma.id, dolma],
]);

const baseInput = {
  restaurantId: 'rest-1',
  catalog,
  deliveryFeeIqd: 2_000,
  platformServiceFeeIqd: 1_000,
  commissionRateBps: 2_000,
  minimumOrderIqd: 0,
};

describe('buildQuote() — server-side pricing', () => {
  it('prices a simple line from the catalog, ignoring anything the client thinks', () => {
    const quote = buildQuote({
      ...baseInput,
      requestedLines: [{ menuItemId: 'item-dolma', quantity: 2, modifierIds: [] }],
    });
    expect(quote.lines[0]?.unitPriceIqdSnapshot).toBe(6_000);
    expect(quote.lines[0]?.lineTotalIqd).toBe(12_000);
    expect(quote.totals.itemsSubtotalIqd).toBe(12_000);
    expect(quote.totals.customerTotalIqd).toBe(15_000); // + 2,000 delivery + 1,000 service
  });

  it('adds modifier prices per unit, then multiplies by quantity', () => {
    const quote = buildQuote({
      ...baseInput,
      requestedLines: [
        { menuItemId: 'item-kebab', quantity: 2, modifierIds: ['m-large', 'm-cheese'] },
      ],
    });
    // (12,000 + 2,000 + 500) × 2 = 29,000
    expect(quote.lines[0]?.lineTotalIqd).toBe(29_000);
    expect(quote.totals.itemsSubtotalIqd).toBe(29_000);
  });

  it('snapshots Arabic names and cost price for later reporting', () => {
    const quote = buildQuote({
      ...baseInput,
      requestedLines: [{ menuItemId: 'item-kebab', quantity: 1, modifierIds: ['m-small'] }],
    });
    const line = quote.lines[0];
    expect(line?.nameArSnapshot).toBe('كباب عراقي');
    expect(line?.costPriceIqdSnapshot).toBe(7_000);
    expect(line?.modifiers[0]?.nameArSnapshot).toBe('صغير');
    expect(line?.modifiers[0]?.groupNameArSnapshot).toBe('الحجم');
  });

  it('computes commission from the items subtotal, excluding fees', () => {
    const quote = buildQuote({
      ...baseInput,
      requestedLines: [{ menuItemId: 'item-dolma', quantity: 1, modifierIds: [] }],
    });
    expect(quote.totals.commissionBaseIqd).toBe(6_000);
    expect(quote.totals.commissionAmountIqd).toBe(1_200); // 20% of 6,000
  });
});

describe('tenant isolation in pricing (plan §63)', () => {
  it('refuses an item belonging to another restaurant', () => {
    const foreign: CatalogItem = { ...dolma, id: 'item-foreign', restaurantId: 'rest-2' };
    expect(() =>
      buildQuote({
        ...baseInput,
        catalog: new Map([[foreign.id, foreign]]),
        requestedLines: [{ menuItemId: 'item-foreign', quantity: 1, modifierIds: [] }],
      }),
    ).toThrow(expect.objectContaining({ code: 'ITEM_NOT_IN_RESTAURANT' }));
  });

  it('refuses an unknown item ID', () => {
    expect(() =>
      buildQuote({
        ...baseInput,
        requestedLines: [{ menuItemId: 'item-nope', quantity: 1, modifierIds: [] }],
      }),
    ).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
  });
});

describe('availability (plan §112 ITEM_UNAVAILABLE)', () => {
  it('refuses an unavailable item and names it for the Arabic message', () => {
    const soldOut = { ...dolma, isAvailable: false };
    const error = expectAppError(
      () =>
        buildQuote({
          ...baseInput,
          catalog: new Map([[soldOut.id, soldOut]]),
          requestedLines: [{ menuItemId: soldOut.id, quantity: 1, modifierIds: [] }],
        }),
      'ITEM_UNAVAILABLE',
    );
    expect(error.details).toMatchObject({ nameAr: 'دولمة' });
  });

  it('refuses a deactivated item', () => {
    const inactive = { ...dolma, isActive: false };
    expect(() =>
      buildQuote({
        ...baseInput,
        catalog: new Map([[inactive.id, inactive]]),
        requestedLines: [{ menuItemId: inactive.id, quantity: 1, modifierIds: [] }],
      }),
    ).toThrow(expect.objectContaining({ code: 'ITEM_UNAVAILABLE' }));
  });

  it('refuses an unavailable modifier', () => {
    expect(() =>
      buildQuote({
        ...baseInput,
        requestedLines: [
          { menuItemId: 'item-kebab', quantity: 1, modifierIds: ['m-small', 'm-olives'] },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'ITEM_UNAVAILABLE' }));
  });
});

describe('modifier rules (plan §20)', () => {
  it('requires a selection from a required group', () => {
    expect(() =>
      buildQuote({
        ...baseInput,
        requestedLines: [{ menuItemId: 'item-kebab', quantity: 1, modifierIds: [] }],
      }),
    ).toThrow(expect.objectContaining({ code: 'MODIFIER_SELECTION_INVALID' }));
  });

  it('enforces maxSelect', () => {
    expect(() =>
      buildQuote({
        ...baseInput,
        requestedLines: [
          { menuItemId: 'item-kebab', quantity: 1, modifierIds: ['m-small', 'm-large'] },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'MODIFIER_SELECTION_INVALID' }));
  });

  it('allows an optional group to be skipped', () => {
    const quote = buildQuote({
      ...baseInput,
      requestedLines: [{ menuItemId: 'item-kebab', quantity: 1, modifierIds: ['m-small'] }],
    });
    expect(quote.totals.itemsSubtotalIqd).toBe(12_000);
  });

  it('refuses a modifier that belongs to a different item', () => {
    expect(() =>
      buildQuote({
        ...baseInput,
        requestedLines: [{ menuItemId: 'item-dolma', quantity: 1, modifierIds: ['m-cheese'] }],
      }),
    ).toThrow(expect.objectContaining({ code: 'MODIFIER_SELECTION_INVALID' }));
  });

  it('refuses a fabricated modifier ID', () => {
    expect(() =>
      buildQuote({
        ...baseInput,
        requestedLines: [
          { menuItemId: 'item-kebab', quantity: 1, modifierIds: ['m-small', 'm-free-lunch'] },
        ],
      }),
    ).toThrow(expect.objectContaining({ code: 'MODIFIER_SELECTION_INVALID' }));
  });
});

describe('minimum order (plan §112)', () => {
  it('rejects a cart below the minimum, on the items subtotal', () => {
    const error = expectAppError(
      () =>
        buildQuote({
          ...baseInput,
          minimumOrderIqd: 10_000,
          requestedLines: [{ menuItemId: 'item-dolma', quantity: 1, modifierIds: [] }],
        }),
      'MINIMUM_ORDER_NOT_MET',
    );
    // The fees must not be counted toward reaching the minimum.
    expect(error.details).toMatchObject({ minimumOrderIqd: 10_000, itemsSubtotalIqd: 6_000 });
  });

  it('accepts a cart exactly at the minimum', () => {
    expect(() =>
      buildQuote({
        ...baseInput,
        minimumOrderIqd: 6_000,
        requestedLines: [{ menuItemId: 'item-dolma', quantity: 1, modifierIds: [] }],
      }),
    ).not.toThrow();
  });
});

describe('empty cart', () => {
  it('is rejected', () => {
    expect(() => buildQuote({ ...baseInput, requestedLines: [] })).toThrow(
      expect.objectContaining({ code: 'CART_EMPTY' }),
    );
  });
});

describe('assertQuoteUnchanged() — price tampering and drift', () => {
  const quote = buildQuote({
    ...baseInput,
    requestedLines: [{ menuItemId: 'item-dolma', quantity: 1, modifierIds: [] }],
  });

  it('passes when the client total matches', () => {
    expect(() => assertQuoteUnchanged(9_000, quote.totals)).not.toThrow();
  });

  it('passes when the client sends nothing to compare', () => {
    expect(() => assertQuoteUnchanged(null, quote.totals)).not.toThrow();
    expect(() => assertQuoteUnchanged(undefined, quote.totals)).not.toThrow();
  });

  it('rejects a tampered lower total and reports the real one', () => {
    const error = expectAppError(() => assertQuoteUnchanged(1, quote.totals), 'PRICE_CHANGED');
    expect(error.details).toMatchObject({ expectedTotalIqd: 1, currentTotalIqd: 9_000 });
  });
});

describe('resolveCommissionRate() — effective dating (plan §24)', () => {
  const configs = [
    {
      commissionRateBps: 1_200,
      effectiveFrom: new Date('2025-01-01T00:00:00Z'),
      effectiveTo: new Date('2025-06-01T00:00:00Z'),
    },
    {
      commissionRateBps: 2_000,
      effectiveFrom: new Date('2025-06-01T00:00:00Z'),
      effectiveTo: null,
    },
  ];

  it('picks the rate in force at the given moment', () => {
    expect(resolveCommissionRate(configs, new Date('2025-03-01T00:00:00Z'))).toBe(1_200);
    expect(resolveCommissionRate(configs, new Date('2025-08-01T00:00:00Z'))).toBe(2_000);
  });

  it('treats effectiveTo as exclusive', () => {
    expect(resolveCommissionRate(configs, new Date('2025-06-01T00:00:00Z'))).toBe(2_000);
  });

  it('treats effectiveFrom as inclusive', () => {
    expect(resolveCommissionRate(configs, new Date('2025-01-01T00:00:00Z'))).toBe(1_200);
  });

  it('fails loudly when no rate is configured rather than defaulting to zero', () => {
    expect(() => resolveCommissionRate(configs, new Date('2024-01-01T00:00:00Z'))).toThrow(
      expect.objectContaining({ code: 'COMMISSION_CONFIG_MISSING' }),
    );
    expect(() => resolveCommissionRate([], new Date())).toThrow(
      expect.objectContaining({ code: 'COMMISSION_CONFIG_MISSING' }),
    );
  });
});
