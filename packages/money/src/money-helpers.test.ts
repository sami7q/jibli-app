import { describe, expect, it } from 'vitest';
import {
  addIqd,
  applyBps,
  bps,
  clampNonNegative,
  formatIqdDigits,
  iqd,
  isIqd,
  maxIqd,
  minIqd,
  MoneyError,
  multiplyIqd,
  ZERO_IQD,
} from './money.js';

/**
 * The small helpers around the dinar. Each is a line or two, and each is on
 * the path of a statement, a cart total or a settlement — which is why the
 * package carries a coverage threshold and why these are pinned rather than
 * assumed.
 */

describe('isIqd()', () => {
  it('accepts a safe integer within range, in either sign', () => {
    expect(isIqd(0)).toBe(true);
    expect(isIqd(31_000)).toBe(true);
    expect(isIqd(-500)).toBe(true);
  });

  it('refuses fractions, strings, NaN and amounts beyond the range', () => {
    expect(isIqd(1.5)).toBe(false);
    expect(isIqd('1000')).toBe(false);
    expect(isIqd(Number.NaN)).toBe(false);
    expect(isIqd(10_000_000_000)).toBe(false);
  });
});

describe('addIqd()', () => {
  it('sums any number of amounts', () => {
    expect(addIqd(iqd(1000), iqd(2500), iqd(500))).toBe(4000);
  });

  it('is zero with nothing to add', () => {
    expect(addIqd()).toBe(ZERO_IQD);
  });

  it('refuses a sum that leaves the supported range', () => {
    expect(() => addIqd(iqd(9_999_999_999), iqd(1))).toThrow(MoneyError);
  });
});

describe('multiplyIqd()', () => {
  it('multiplies a unit price by a quantity', () => {
    expect(multiplyIqd(iqd(2500), 3)).toBe(7500);
    expect(multiplyIqd(iqd(2500), 0)).toBe(0);
  });

  it('refuses a fractional or negative quantity', () => {
    expect(() => multiplyIqd(iqd(2500), 1.5)).toThrow(MoneyError);
    expect(() => multiplyIqd(iqd(2500), -1)).toThrow(MoneyError);
  });
});

describe('clampNonNegative(), minIqd(), maxIqd()', () => {
  it('floors a negative balance at zero and leaves the rest alone', () => {
    expect(clampNonNegative(iqd(-250))).toBe(ZERO_IQD);
    expect(clampNonNegative(iqd(250))).toBe(250);
    expect(clampNonNegative(ZERO_IQD)).toBe(ZERO_IQD);
  });

  it('picks the smaller and the larger, and is stable on a tie', () => {
    expect(minIqd(iqd(1000), iqd(2000))).toBe(1000);
    expect(minIqd(iqd(2000), iqd(1000))).toBe(1000);
    expect(maxIqd(iqd(1000), iqd(2000))).toBe(2000);
    expect(maxIqd(iqd(2000), iqd(1000))).toBe(2000);
    expect(minIqd(iqd(7), iqd(7))).toBe(7);
    expect(maxIqd(iqd(7), iqd(7))).toBe(7);
  });
});

describe('applyBps() at the edge of the range', () => {
  it('stays exact at the largest amount and the full rate', () => {
    // MAX_IQD × 10,000 is still a safe integer, so the precision guard inside
    // applyBps is unreachable through the branded types — and the arithmetic
    // at that corner must still come out whole.
    expect(applyBps(iqd(9_999_999_999), bps(10_000))).toBe(9_999_999_999);
    expect(applyBps(iqd(9_999_999_999), bps(1))).toBe(1_000_000);
  });
});

describe('formatIqdDigits()', () => {
  it('groups thousands with no currency suffix', () => {
    expect(formatIqdDigits(iqd(31_000))).toBe('31,000');
    expect(formatIqdDigits(iqd(0))).toBe('0');
    expect(formatIqdDigits(iqd(1_250_000))).toBe('1,250,000');
  });
});
