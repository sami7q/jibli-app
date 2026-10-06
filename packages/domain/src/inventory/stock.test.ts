import { describe, expect, it } from 'vitest';
import {
  applyMovement,
  availableQuantity,
  consumeReservation,
  explodeRecipes,
  fromMilliUnits,
  isLowStock,
  releaseReservation,
  reserveStock,
  toMilliUnits,
  type StockLevel,
} from './stock.js';

const level = (over: Partial<StockLevel> = {}): StockLevel => ({
  onHand: '10.000',
  reserved: '0.000',
  allowNegativeStock: false,
  lowStockThreshold: null,
  ...over,
});

describe('fixed-precision quantity arithmetic (plan §101)', () => {
  it('parses and renders without floating-point drift', () => {
    expect(toMilliUnits('0.250')).toBe(250);
    expect(toMilliUnits('20.500')).toBe(20_500);
    expect(fromMilliUnits(250)).toBe('0.250');
    expect(fromMilliUnits(20_500)).toBe('20.500');
  });

  it('survives the classic 0.1 + 0.2 case exactly', () => {
    const sum = fromMilliUnits(toMilliUnits('0.100') + toMilliUnits('0.200'));
    expect(sum).toBe('0.300');
    // The naive float version does not.
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('accumulates a hundred small quantities exactly', () => {
    let total = 0;
    for (let i = 0; i < 100; i += 1) total += toMilliUnits('0.001');
    expect(fromMilliUnits(total)).toBe('0.100');
  });

  it('pads and truncates to the column scale', () => {
    expect(toMilliUnits('1.5')).toBe(1_500);
    expect(toMilliUnits('1')).toBe(1_000);
    expect(toMilliUnits('1.9999')).toBe(1_999); // truncated at 3 dp
  });

  it('handles negatives', () => {
    expect(toMilliUnits('-2.500')).toBe(-2_500);
    expect(fromMilliUnits(-2_500)).toBe('-2.500');
  });

  it('rejects malformed input', () => {
    expect(() => toMilliUnits('abc')).toThrow();
    expect(() => toMilliUnits('')).toThrow();
  });
});

describe('availableQuantity()', () => {
  it('subtracts what is already reserved', () => {
    expect(availableQuantity({ onHand: '10.000', reserved: '3.500' })).toBe('6.500');
  });

  it('can be zero', () => {
    expect(availableQuantity({ onHand: '3.000', reserved: '3.000' })).toBe('0.000');
  });
});

describe('reserveStock() — the last-unit race (plan §36, §183)', () => {
  it('reserves when stock is available', () => {
    const result = reserveStock(level({ onHand: '5.000' }), '2.000');
    expect(result.newReserved).toBe('2.000');
    expect(result.availableAfter).toBe('3.000');
  });

  it('allows reserving exactly the last unit', () => {
    const result = reserveStock(level({ onHand: '1.000' }), '1.000');
    expect(result.newReserved).toBe('1.000');
    expect(result.availableAfter).toBe('0.000');
  });

  it('refuses the second claim on the last unit', () => {
    // First order reserved it; the second sees reserved = on hand.
    const afterFirst = level({ onHand: '1.000', reserved: '1.000' });
    expect(() => reserveStock(afterFirst, '1.000')).toThrow(
      expect.objectContaining({ code: 'INSUFFICIENT_STOCK' }),
    );
  });

  it('reports what was available so the UI can explain', () => {
    try {
      reserveStock(level({ onHand: '2.000', reserved: '1.500' }), '1.000');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as { details: Record<string, unknown> }).details).toMatchObject({
        requested: '1.000',
        available: '0.500',
      });
    }
  });

  it('permits overselling only where the restaurant opted in', () => {
    const result = reserveStock(level({ onHand: '0.000', allowNegativeStock: true }), '5.000');
    expect(result.newReserved).toBe('5.000');
    expect(result.availableAfter).toBe('-5.000');
  });

  it('rejects a non-positive reservation', () => {
    expect(() => reserveStock(level(), '0')).toThrow();
    expect(() => reserveStock(level(), '-1.000')).toThrow();
  });
});

describe('releaseReservation() — rejection and cancellation (plan §36)', () => {
  it('gives the stock back', () => {
    expect(releaseReservation(level({ reserved: '3.000' }), '1.000')).toBe('2.000');
  });

  it('never drives reserved negative, even on a double release', () => {
    expect(releaseReservation(level({ reserved: '1.000' }), '5.000')).toBe('0.000');
  });
});

describe('consumeReservation()', () => {
  it('lowers on-hand and clears the hold together', () => {
    const result = consumeReservation(level({ onHand: '10.000', reserved: '2.000' }), '2.000');
    expect(result.newOnHand).toBe('8.000');
    expect(result.newReserved).toBe('0.000');
  });

  it('refuses to drive stock negative by default', () => {
    expect(() =>
      consumeReservation(level({ onHand: '1.000', reserved: '1.000' }), '2.000'),
    ).toThrow(expect.objectContaining({ code: 'INSUFFICIENT_STOCK' }));
  });

  it('allows negative stock where configured', () => {
    const result = consumeReservation(
      level({ onHand: '1.000', reserved: '1.000', allowNegativeStock: true }),
      '2.000',
    );
    expect(result.newOnHand).toBe('-1.000');
  });
});

describe('applyMovement()', () => {
  it('adds stock on receipt', () => {
    expect(applyMovement(level(), 'PURCHASE', '5.500').newOnHand).toBe('15.500');
  });

  it('requires a reason for a manual adjustment (plan §35)', () => {
    expect(() => applyMovement(level(), 'ADJUSTMENT', '-1.000')).toThrow(
      expect.objectContaining({ code: 'INVENTORY_ADJUSTMENT_REASON_REQUIRED' }),
    );
    expect(() => applyMovement(level(), 'WASTE', '-1.000', '   ')).toThrow(
      expect.objectContaining({ code: 'INVENTORY_ADJUSTMENT_REASON_REQUIRED' }),
    );
  });

  it('accepts a manual adjustment with a reason', () => {
    expect(applyMovement(level(), 'ADJUSTMENT', '-1.000', 'جرد فعلي').newOnHand).toBe('9.000');
  });

  it('does not require a reason for an automatic movement', () => {
    expect(() => applyMovement(level(), 'SALE_CONSUMPTION', '-1.000')).not.toThrow();
  });

  it('refuses to drive stock negative by default', () => {
    expect(() => applyMovement(level({ onHand: '1.000' }), 'WASTE', '-5.000', 'تلف')).toThrow(
      expect.objectContaining({ code: 'INSUFFICIENT_STOCK' }),
    );
  });
});

describe('isLowStock() — measured on available, not on-hand', () => {
  it('is false with no threshold configured', () => {
    expect(isLowStock(level({ onHand: '0.000' }))).toBe(false);
  });

  it('fires at the threshold', () => {
    expect(isLowStock(level({ onHand: '3.000', lowStockThreshold: '3.000' }))).toBe(true);
  });

  it('does not fire above the threshold', () => {
    expect(isLowStock(level({ onHand: '4.000', lowStockThreshold: '3.000' }))).toBe(false);
  });

  it('counts reserved stock as gone', () => {
    // 10 on hand but 8 reserved leaves 2 sellable, which is below the threshold.
    expect(
      isLowStock(level({ onHand: '10.000', reserved: '8.000', lowStockThreshold: '3.000' })),
    ).toBe(true);
  });
});

describe('explodeRecipes() — plan §37 burger example', () => {
  const recipes = new Map([
    [
      'item-burger',
      [
        { inventoryItemId: 'inv-bun', quantityPerUnit: '1.000' },
        { inventoryItemId: 'inv-patty', quantityPerUnit: '1.000' },
        { inventoryItemId: 'inv-sauce', quantityPerUnit: '0.020' }, // 20 g
        { inventoryItemId: 'inv-cheese', quantityPerUnit: '1.000' },
      ],
    ],
  ]);

  it('multiplies each ingredient by the line quantity', () => {
    const needed = explodeRecipes([{ menuItemId: 'item-burger', quantity: 3 }], recipes);
    expect(needed.get('inv-bun')).toBe('3.000');
    expect(needed.get('inv-sauce')).toBe('0.060');
  });

  it('sums the same ingredient across lines', () => {
    const needed = explodeRecipes(
      [
        { menuItemId: 'item-burger', quantity: 2 },
        { menuItemId: 'item-burger', quantity: 1 },
      ],
      recipes,
    );
    expect(needed.get('inv-patty')).toBe('3.000');
  });

  it('ignores items with no recipe', () => {
    const needed = explodeRecipes([{ menuItemId: 'item-drink', quantity: 5 }], recipes);
    expect(needed.size).toBe(0);
  });
});
