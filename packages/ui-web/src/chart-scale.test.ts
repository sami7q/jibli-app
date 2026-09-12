import { describe, expect, it } from 'vitest';
import { axisTicks, niceCeiling } from './chart-scale.js';

/**
 * The bug: an axis tick of 0.25 on a near-empty chart. The dinar is an integer
 * currency, so formatting that value threw `MoneyError` during render, React
 * unmounted the tree, and the admin dashboard showed "Application error: a
 * client-side exception has occurred" — nothing else on the page survived.
 *
 * It passed every check before it shipped, because it was exercised with
 * data the size of the reference design, where the ceiling is always a
 * multiple of four. A new deployment with an empty database hits it on the
 * first page load.
 */

describe('axisTicks()', () => {
  it('never produces a fractional value, at any scale', () => {
    /*
     * The whole point. Small ceilings are the dangerous ones: 1 was the value
     * that actually crashed production, because niceCeiling floors an empty
     * series at 1 and a quarter of 1 is not a dinar.
     */
    for (const max of [0, 1, 2, 3, 4, 5, 7, 9, 10, 13, 99, 100, 250, 1_000, 18_430_000]) {
      for (const tick of axisTicks(max)) {
        expect(Number.isInteger(tick.value), `max=${max} produced ${tick.value}`).toBe(true);
      }
    }
  });

  it('names the baseline and the ceiling, always', () => {
    for (const max of [0, 1, 4, 1_000_000]) {
      const ticks = axisTicks(max);
      expect(ticks[0]?.fraction).toBe(0);
      expect(ticks[0]?.value).toBe(0);
      expect(ticks[ticks.length - 1]?.fraction).toBe(1);
      expect(ticks[ticks.length - 1]?.value).toBe(Math.round(max));
    }
  });

  it('gives five ticks once the scale can carry five distinct values', () => {
    expect(axisTicks(1_000_000)).toHaveLength(5);
    expect(axisTicks(4)).toHaveLength(5);
  });

  it('falls back to two rather than repeating a value', () => {
    /*
     * A ceiling of 1 would otherwise read "0, 0, 1, 1, 1" up the side of the
     * chart, which says less than nothing.
     */
    expect(axisTicks(1)).toEqual([
      { fraction: 0, value: 0 },
      { fraction: 1, value: 1 },
    ]);
    expect(axisTicks(2)).toHaveLength(2);
  });

  it('keeps ticks in ascending order', () => {
    for (const max of [0, 1, 3, 40, 5_000]) {
      const values = axisTicks(max).map((tick) => tick.value);
      expect([...values].sort((a, b) => a - b)).toEqual(values);
    }
  });
});

describe('niceCeiling()', () => {
  it('floors an empty series at 1 rather than 0', () => {
    // A ceiling of zero divides by nothing and flattens every point.
    expect(niceCeiling(0)).toBe(1);
    expect(niceCeiling(-5)).toBe(1);
  });

  it('rounds up to 1, 2, 5 or 10 times a power of ten', () => {
    expect(niceCeiling(1)).toBe(1);
    expect(niceCeiling(7)).toBe(10);
    expect(niceCeiling(12)).toBe(20);
    expect(niceCeiling(45)).toBe(50);
    expect(niceCeiling(18_430_000)).toBe(20_000_000);
  });

  it('never returns a ceiling below the value it has to contain', () => {
    for (const value of [1, 3, 8, 17, 64, 999, 1_234_567]) {
      expect(niceCeiling(value)).toBeGreaterThanOrEqual(value);
    }
  });
});
