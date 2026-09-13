import { describe, expect, it } from 'vitest';
import { bps, iqd, MoneyError } from './money.js';
import { calculateOrderTotals, commissionFromSnapshot, lineTotal } from './order-total.js';

const line = (unit: number, qty: number, modifiers: number[] = []) => ({
  unitPriceIqd: iqd(unit),
  quantity: qty,
  modifierUnitPricesIqd: modifiers.map((m) => iqd(m)),
});

/** The platform default, and what every case below uses unless it says otherwise. */
const FEE = iqd(500);

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

describe('calculateOrderTotals() — the worked example', () => {
  const totals = calculateOrderTotals({
    lines: [line(30_000, 1)],
    discounts: [{ amountIqd: iqd(2_000), funding: 'RESTAURANT' }],
    deliveryFeeIqd: iqd(2_000),
    platformServiceFeeIqd: iqd(1_000),
    commissionFlatIqd: FEE,
  });

  it('produces the documented customer total', () => {
    expect(totals.itemsSubtotalIqd).toBe(30_000);
    expect(totals.restaurantFundedDiscountIqd).toBe(2_000);
    expect(totals.deliveryFeeIqd).toBe(2_000);
    expect(totals.platformServiceFeeIqd).toBe(1_000);
    expect(totals.customerTotalIqd).toBe(31_000);
  });

  it('charges the flat fee, not a share of the base', () => {
    expect(totals.commissionBaseIqd).toBe(28_000);
    expect(totals.commissionFlatIqdSnapshot).toBe(500);
    expect(totals.commissionAmountIqd).toBe(500);
  });

  it('leaves the restaurant its net plus the delivery fee it earned', () => {
    // 28,000 - 500 + 2,000 delivery (restaurant-owned driver).
    expect(totals.restaurantNetIqd).toBe(29_500);
  });

  it('counts only commission and service fee as platform revenue', () => {
    expect(totals.platformRevenueIqd).toBe(1_500);
  });
});

describe('the fee does not move with the order', () => {
  const at = (subtotal: number) =>
    calculateOrderTotals({
      lines: [line(subtotal, 1)],
      deliveryFeeIqd: iqd(0),
      platformServiceFeeIqd: iqd(0),
      commissionFlatIqd: FEE,
    });

  it('charges 500 on a small order and on a large one alike', () => {
    expect(at(5_000).commissionAmountIqd).toBe(500);
    expect(at(50_000).commissionAmountIqd).toBe(500);
    expect(at(500_000).commissionAmountIqd).toBe(500);
  });

  it('gives the restaurant every dinar above the fee', () => {
    expect(at(5_000).restaurantNetIqd).toBe(4_500);
    expect(at(50_000).restaurantNetIqd).toBe(49_500);
  });
});

describe('the fee is capped at what the restaurant earned', () => {
  /*
   * A minimum order should keep this from happening, but the arithmetic must
   * not depend on a policy: a commission larger than the order would put the
   * restaurant's net below zero and make it owe Jibli money for selling food.
   */
  it('never exceeds the commission base', () => {
    const totals = calculateOrderTotals({
      lines: [line(300, 1)],
      deliveryFeeIqd: iqd(0),
      platformServiceFeeIqd: iqd(0),
      commissionFlatIqd: FEE,
    });
    expect(totals.commissionBaseIqd).toBe(300);
    expect(totals.commissionAmountIqd).toBe(300);
    expect(totals.restaurantNetIqd).toBe(0);
  });

  it('is zero when a restaurant-funded discount wipes out the base', () => {
    const totals = calculateOrderTotals({
      lines: [line(10_000, 1)],
      discounts: [{ amountIqd: iqd(50_000), funding: 'RESTAURANT' }],
      deliveryFeeIqd: iqd(0),
      platformServiceFeeIqd: iqd(0),
      commissionFlatIqd: FEE,
    });
    expect(totals.commissionBaseIqd).toBe(0);
    expect(totals.commissionAmountIqd).toBe(0);
    expect(totals.customerTotalIqd).toBe(0);
  });

  it('still records the configured fee in the snapshot, not the capped amount', () => {
    const totals = calculateOrderTotals({
      lines: [line(300, 1)],
      deliveryFeeIqd: iqd(0),
      platformServiceFeeIqd: iqd(0),
      commissionFlatIqd: FEE,
    });
    expect(totals.commissionFlatIqdSnapshot).toBe(500);
    expect(totals.commissionAmountIqd).toBe(300);
  });
});

describe('discount funding decides the commission base', () => {
  const base = {
    lines: [line(10_000, 1)],
    deliveryFeeIqd: iqd(0),
    platformServiceFeeIqd: iqd(0),
    commissionFlatIqd: FEE,
  } as const;

  it('restaurant-funded discount reduces the commission base', () => {
    const totals = calculateOrderTotals({
      ...base,
      discounts: [{ amountIqd: iqd(2_000), funding: 'RESTAURANT' }],
    });
    expect(totals.commissionBaseIqd).toBe(8_000);
    expect(totals.customerTotalIqd).toBe(8_000);
  });

  it('platform-funded discount does NOT reduce the commission base', () => {
    const totals = calculateOrderTotals({
      ...base,
      discounts: [{ amountIqd: iqd(2_000), funding: 'PLATFORM' }],
    });
    expect(totals.commissionBaseIqd).toBe(10_000);
    expect(totals.customerTotalIqd).toBe(8_000);
    // Platform funded the 2,000, so its revenue is commission minus what it funded.
    expect(totals.platformRevenueIqd).toBe(-1_500);
  });

  it('shared discount splits exactly, with the platform absorbing the remainder', () => {
    const totals = calculateOrderTotals({
      ...base,
      discounts: [{ amountIqd: iqd(999), funding: 'SHARED', restaurantShareBps: bps(5_000) }],
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
});

describe('delivery fee beneficiary', () => {
  const base = {
    lines: [line(20_000, 1)],
    deliveryFeeIqd: iqd(3_000),
    platformServiceFeeIqd: iqd(1_000),
    commissionFlatIqd: FEE,
  } as const;

  it('credits the restaurant by default (Release 1 restaurant-owned drivers)', () => {
    const totals = calculateOrderTotals(base);
    expect(totals.restaurantNetIqd).toBe(22_500); // 20,000 - 500 + 3,000
    expect(totals.platformRevenueIqd).toBe(1_500); // 500 commission + 1,000 fee
  });

  it('credits the platform when it owns delivery', () => {
    const totals = calculateOrderTotals({ ...base, deliveryFeeBeneficiary: 'PLATFORM' });
    expect(totals.restaurantNetIqd).toBe(19_500);
    expect(totals.platformRevenueIqd).toBe(4_500);
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
        commissionFlatIqd: FEE,
      }),
    ).toThrow(MoneyError);
  });

  it('refuses negative fees', () => {
    expect(() =>
      calculateOrderTotals({
        lines: [line(1_000, 1)],
        deliveryFeeIqd: iqd(-1),
        platformServiceFeeIqd: iqd(0),
        commissionFlatIqd: FEE,
      }),
    ).toThrow(MoneyError);
  });

  it('refuses a negative commission', () => {
    expect(() =>
      calculateOrderTotals({
        lines: [line(1_000, 1)],
        deliveryFeeIqd: iqd(0),
        platformServiceFeeIqd: iqd(0),
        commissionFlatIqd: iqd(-500),
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
        commissionFlatIqd: FEE,
      }),
    ).toThrow(MoneyError);
  });
});

describe('commissionFromSnapshot() — historical orders are immune to fee changes', () => {
  it('re-derives the original commission even after the fee changes', () => {
    const placed = calculateOrderTotals({
      lines: [line(28_000, 1)],
      deliveryFeeIqd: iqd(0),
      platformServiceFeeIqd: iqd(0),
      commissionFlatIqd: iqd(500),
    });

    // Admin later raises the fee to 750. The snapshot must not move.
    const recomputed = commissionFromSnapshot({
      commissionBaseIqd: placed.commissionBaseIqd,
      commissionFlatIqdSnapshot: placed.commissionFlatIqdSnapshot,
    });

    expect(recomputed).toBe(500);
    expect(recomputed).toBe(placed.commissionAmountIqd);
  });

  it('applies the same cap the original calculation did', () => {
    expect(
      commissionFromSnapshot({ commissionBaseIqd: iqd(300), commissionFlatIqdSnapshot: iqd(500) }),
    ).toBe(300);
  });
});
