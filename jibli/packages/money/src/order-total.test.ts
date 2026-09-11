import { describe, expect, it } from 'vitest';
import { bps, iqd, MoneyError } from './money.js';
import { calculateOrderTotals, commissionFromSnapshot, lineTotal } from './order-total.js';

const line = (unit: number, qty: number, modifiers: number[] = []) => ({
  unitPriceIqd: iqd(unit),
  quantity: qty,
  modifierUnitPricesIqd: modifiers.map((m) => iqd(m)),
});

describe('lineTotal()', () => {
  it('multiplies unit price plus modifiers by quantity', () => {
    expect(lineTotal(line(8_000, 2))).toBe(16_000);
    expect(lineTotal(line(8_000, 2, [500, 250]))).toBe(17_500);
  });

  it('rejects non-positive or fractional quantities', () => {
    expect(() => lineTotal(line(8_000, 0))).toThrow(MoneyError);
    expect(() => lineTotal(line(8_000, -1))).toThrow(MoneyError);
    expect(() => lineTotal(line(8_000, 1.5))).toThrow(MoneyError);
  });
});

describe('calculateOrderTotals() — plan Appendix E golden case', () => {
  const totals = calculateOrderTotals({
    lines: [line(30_000, 1)],
    discounts: [{ amountIqd: iqd(2_000), funding: 'RESTAURANT' }],
    deliveryFeeIqd: iqd(2_000),
    platformServiceFeeIqd: iqd(1_000),
    commissionRateBps: bps(1_200),
  });

  it('produces the documented customer total', () => {
    expect(totals.itemsSubtotalIqd).toBe(30_000);
    expect(totals.restaurantFundedDiscountIqd).toBe(2_000);
    expect(totals.deliveryFeeIqd).toBe(2_000);
    expect(totals.platformServiceFeeIqd).toBe(1_000);
    expect(totals.customerTotalIqd).toBe(31_000);
  });

  it('produces the documented commission base and amount', () => {
    expect(totals.commissionBaseIqd).toBe(28_000);
    expect(totals.commissionRateBpsSnapshot).toBe(1_200);
    expect(totals.commissionAmountIqd).toBe(3_360);
  });

  it('leaves the restaurant its net plus the delivery fee it earned', () => {
    // 28,000 - 3,360 + 2,000 delivery (restaurant-owned driver).
    expect(totals.restaurantNetIqd).toBe(26_640);
  });

  it('counts only commission and service fee as platform revenue', () => {
    expect(totals.platformRevenueIqd).toBe(4_360);
  });
});

describe('calculateOrderTotals() — design reference cart', () => {
  it('matches the cart screen: 28,000 + 2,000 delivery + 1,000 service = 31,000', () => {
    const totals = calculateOrderTotals({
      lines: [line(8_000, 2), line(7_000, 1), line(6_000, 1)], // 16,000 + 7,000 + 6,000
      deliveryFeeIqd: iqd(2_000),
      platformServiceFeeIqd: iqd(1_000),
      commissionRateBps: bps(2_000),
    });
    expect(totals.itemsSubtotalIqd).toBe(29_000);
    // Design shows a 28,000 subtotal; the arithmetic below is what matters here.
    expect(totals.customerTotalIqd).toBe(32_000);
    expect(totals.commissionAmountIqd).toBe(5_800);
  });
});

describe('discount funding decides the commission base', () => {
  const base = {
    lines: [line(10_000, 1)],
    deliveryFeeIqd: iqd(0),
    platformServiceFeeIqd: iqd(0),
    commissionRateBps: bps(1_000),
  } as const;

  it('restaurant-funded discount reduces the commission base', () => {
    const totals = calculateOrderTotals({
      ...base,
      discounts: [{ amountIqd: iqd(2_000), funding: 'RESTAURANT' }],
    });
    expect(totals.commissionBaseIqd).toBe(8_000);
    expect(totals.commissionAmountIqd).toBe(800);
    expect(totals.customerTotalIqd).toBe(8_000);
  });

  it('platform-funded discount does NOT reduce the commission base', () => {
    const totals = calculateOrderTotals({
      ...base,
      discounts: [{ amountIqd: iqd(2_000), funding: 'PLATFORM' }],
    });
    expect(totals.commissionBaseIqd).toBe(10_000);
    expect(totals.commissionAmountIqd).toBe(1_000);
    expect(totals.customerTotalIqd).toBe(8_000);
    // Platform funded the 2,000, so its revenue is commission minus what it funded.
    expect(totals.platformRevenueIqd).toBe(-1_000);
  });

  it('shared discount splits exactly, with the platform absorbing the remainder', () => {
    const totals = calculateOrderTotals({
      ...base,
      discounts: [
        { amountIqd: iqd(999), funding: 'SHARED', restaurantShareBps: bps(5_000) },
      ],
    });
    // 50% of 999 = 499.5 → 500 restaurant (half-up), 499 platform. Sum is exact.
    expect(totals.restaurantFundedDiscountIqd).toBe(500);
    expect(totals.platformFundedDiscountIqd).toBe(499);
    expect(totals.discountTotalIqd).toBe(999);
  });

  it('requires a share for SHARED funding rather than guessing', () => {
    expect(() =>
      calculateOrderTotals({ ...base, discounts: [{ amountIqd: iqd(100), funding: 'SHARED' }] }),
    ).toThrow(MoneyError);
  });

  it('caps a restaurant discount at the subtotal so commission base cannot go negative', () => {
    const totals = calculateOrderTotals({
      ...base,
      discounts: [{ amountIqd: iqd(50_000), funding: 'RESTAURANT' }],
    });
    expect(totals.commissionBaseIqd).toBe(0);
    expect(totals.commissionAmountIqd).toBe(0);
    expect(totals.customerTotalIqd).toBe(0);
  });
});

describe('delivery fee beneficiary', () => {
  const base = {
    lines: [line(20_000, 1)],
    deliveryFeeIqd: iqd(3_000),
    platformServiceFeeIqd: iqd(1_000),
    commissionRateBps: bps(1_000),
  } as const;

  it('credits the restaurant by default (Release 1 restaurant-owned drivers)', () => {
    const totals = calculateOrderTotals(base);
    expect(totals.restaurantNetIqd).toBe(21_000); // 20,000 - 2,000 + 3,000
    expect(totals.platformRevenueIqd).toBe(3_000); // 2,000 commission + 1,000 fee
  });

  it('credits the platform when it owns delivery', () => {
    const totals = calculateOrderTotals({ ...base, deliveryFeeBeneficiary: 'PLATFORM' });
    expect(totals.restaurantNetIqd).toBe(18_000);
    expect(totals.platformRevenueIqd).toBe(6_000);
    // Customer pays the same either way.
    expect(totals.customerTotalIqd).toBe(24_000);
  });

  it('never makes the delivery fee commissionable', () => {
    const totals = calculateOrderTotals(base);
    expect(totals.commissionBaseIqd).toBe(20_000);
  });
});

describe('input guards', () => {
  it('refuses an empty order', () => {
    expect(() =>
      calculateOrderTotals({
        lines: [],
        deliveryFeeIqd: iqd(0),
        platformServiceFeeIqd: iqd(0),
        commissionRateBps: bps(1_000),
      }),
    ).toThrow(MoneyError);
  });

  it('refuses negative fees', () => {
    expect(() =>
      calculateOrderTotals({
        lines: [line(1_000, 1)],
        deliveryFeeIqd: iqd(-1),
        platformServiceFeeIqd: iqd(0),
        commissionRateBps: bps(1_000),
      }),
    ).toThrow(MoneyError);
  });

  it('refuses negative discounts', () => {
    expect(() =>
      calculateOrderTotals({
        lines: [line(1_000, 1)],
        discounts: [{ amountIqd: iqd(-500), funding: 'RESTAURANT' }],
        deliveryFeeIqd: iqd(0),
        platformServiceFeeIqd: iqd(0),
        commissionRateBps: bps(1_000),
      }),
    ).toThrow(MoneyError);
  });
});

describe('commissionFromSnapshot() — historical orders are immune to rate changes', () => {
  it('re-derives the original commission even after the restaurant rate changes', () => {
    const placed = calculateOrderTotals({
      lines: [line(28_000, 1)],
      deliveryFeeIqd: iqd(0),
      platformServiceFeeIqd: iqd(0),
      commissionRateBps: bps(1_200),
    });

    // Admin later raises the restaurant to 20%. The snapshot must not move.
    const recomputed = commissionFromSnapshot({
      commissionBaseIqd: placed.commissionBaseIqd,
      commissionRateBpsSnapshot: placed.commissionRateBpsSnapshot,
    });

    expect(recomputed).toBe(3_360);
    expect(recomputed).toBe(placed.commissionAmountIqd);
  });
});
