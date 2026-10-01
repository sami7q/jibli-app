import { describe, expect, it } from 'vitest';
import { evaluateReadiness, isSelfServeMerchantType, type ReadinessInput } from './eligibility';

/**
 * The readiness checklist reads differently for a shop than for a kitchen:
 * the pin and the hours stop blocking, and the words change. A restaurant is
 * read exactly as before.
 */

const allPassing: ReadinessInput = {
  applicationApproved: true,
  cityOrderingEnabled: true,
  ownerActive: true,
  branchLocationValid: true,
  workingHoursConfigured: true,
  hasActiveMenuItem: true,
  commissionConfigured: true,
  settlementPolicyConfigured: true,
  deliveryConfigured: true,
  hasActiveDriver: true,
  orderAlertAcknowledged: true,
  requiredDocumentsPresent: true,
};

const freshShop: ReadinessInput = {
  ...allPassing,
  branchLocationValid: false,
  workingHoursConfigured: false,
  hasActiveDriver: false,
};

describe('evaluateReadiness', () => {
  it('still blocks a restaurant on its pin and its hours', () => {
    const result = evaluateReadiness(freshShop);
    expect(result.ready).toBe(false);
    expect(result.blockingFailures.map((check) => check.key)).toEqual([
      'branchLocationValid',
      'workingHoursConfigured',
    ]);
  });

  it('lets a market or a cosmetics shop go live without a pin or hand-set hours', () => {
    for (const merchantType of ['MARKET', 'COSMETICS'] as const) {
      const result = evaluateReadiness(freshShop, { merchantType });
      expect(result.ready).toBe(true);
      expect(result.blockingFailures).toEqual([]);
      const pin = result.checks.find((check) => check.key === 'branchLocationValid');
      expect(pin?.blocking).toBe(false);
      expect(pin?.passed).toBe(false);
    }
  });

  it('still asks a shop for a product', () => {
    const result = evaluateReadiness(
      { ...freshShop, hasActiveMenuItem: false },
      { merchantType: 'MARKET' },
    );
    expect(result.ready).toBe(false);
    expect(result.blockingFailures.map((check) => check.key)).toEqual(['hasActiveMenuItem']);
  });

  it('speaks of products and a shop to a shop, and of a menu to a restaurant', () => {
    const shop = evaluateReadiness(allPassing, { merchantType: 'COSMETICS' });
    const kitchen = evaluateReadiness(allPassing, { merchantType: 'RESTAURANT' });
    const label = (checks: typeof shop.checks, key: string) =>
      checks.find((check) => check.key === key)?.labelAr;
    expect(label(shop.checks, 'hasActiveMenuItem')).toBe('يوجد منتج واحد على الأقل');
    expect(label(kitchen.checks, 'hasActiveMenuItem')).toBe('يوجد صنف واحد على الأقل في المنيو');
    expect(label(shop.checks, 'commissionConfigured')).toBe(
      label(kitchen.checks, 'commissionConfigured'),
    );
  });

  it('keeps the same twelve keys in the same order for every merchant type', () => {
    const shop = evaluateReadiness(allPassing, { merchantType: 'MARKET' });
    const kitchen = evaluateReadiness(allPassing);
    expect(shop.checks.map((check) => check.key)).toEqual(kitchen.checks.map((check) => check.key));
  });
});

describe('isSelfServeMerchantType', () => {
  it('is the two shop kinds and nothing else', () => {
    expect(isSelfServeMerchantType('MARKET')).toBe(true);
    expect(isSelfServeMerchantType('COSMETICS')).toBe(true);
    expect(isSelfServeMerchantType('RESTAURANT')).toBe(false);
    expect(isSelfServeMerchantType(undefined)).toBe(false);
  });
});
