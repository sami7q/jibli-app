import { describe, expect, it } from 'vitest';
import {
  allocate,
  applyBps,
  bps,
  bpsToPercentString,
  formatIqdArabic,
  iqd,
  MoneyError,
  parseIqd,
  percentToBps,
  roundHalfUp,
  subtractIqd,
} from './money.js';

describe('iqd()', () => {
  it('accepts integers', () => {
    expect(iqd(31_000)).toBe(31_000);
    expect(iqd(0)).toBe(0);
    expect(iqd(-5_000)).toBe(-5_000);
  });

  it('rejects fractional amounts — IQD has no sub-unit in Release 1', () => {
    expect(() => iqd(31_000.5)).toThrow(MoneyError);
    expect(() => iqd(0.1 + 0.2)).toThrow(MoneyError);
  });

  it('rejects NaN and Infinity so a bad division cannot become a price', () => {
    expect(() => iqd(Number.NaN)).toThrow(MoneyError);
    expect(() => iqd(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });

  it('rejects amounts beyond the supported range', () => {
    expect(() => iqd(10_000_000_000)).toThrow(MoneyError);
  });
});

describe('parseIqd()', () => {
  it('parses integer strings from the database and CSV imports', () => {
    expect(parseIqd('28000')).toBe(28_000);
    expect(parseIqd('-1200')).toBe(-1_200);
  });

  it('refuses decimal strings rather than silently truncating', () => {
    expect(() => parseIqd('28000.75')).toThrow(MoneyError);
    expect(() => parseIqd('١٢٣')).toThrow(MoneyError);
    expect(() => parseIqd('')).toThrow(MoneyError);
  });
});

describe('bps()', () => {
  it('accepts the full legal range', () => {
    expect(bps(0)).toBe(0);
    expect(bps(1_200)).toBe(1_200);
    expect(bps(10_000)).toBe(10_000);
  });

  it('rejects out-of-range and fractional rates (DB check constraint mirrors this)', () => {
    expect(() => bps(-1)).toThrow(MoneyError);
    expect(() => bps(10_001)).toThrow(MoneyError);
    expect(() => bps(12.5)).toThrow(MoneyError);
  });
});

describe('roundHalfUp()', () => {
  it('rounds exact halves away from zero', () => {
    expect(roundHalfUp(5, 2)).toBe(3);
    expect(roundHalfUp(-5, 2)).toBe(-3);
    expect(roundHalfUp(7, 2)).toBe(4);
  });

  it('leaves exact divisions alone', () => {
    expect(roundHalfUp(10, 2)).toBe(5);
    expect(roundHalfUp(0, 7)).toBe(0);
  });

  it('rounds below the half down', () => {
    expect(roundHalfUp(4, 3)).toBe(1);
  });

  it('refuses division by zero', () => {
    expect(() => roundHalfUp(1, 0)).toThrow(MoneyError);
  });
});

describe('applyBps() — the commission primitive', () => {
  it('matches the plan Appendix E worked example', () => {
    // 12% of 28,000 = 3,360 exactly.
    expect(applyBps(iqd(28_000), bps(1_200))).toBe(3_360);
  });

  it('applies the half-up policy at a fractional boundary', () => {
    // 12.5% of 1,000 = 125 exactly; 12.5% of 999 = 124.875 → 125.
    expect(applyBps(iqd(1_000), bps(1_250))).toBe(125);
    expect(applyBps(iqd(999), bps(1_250))).toBe(125);
    // 10% of 5 = 0.5 → rounds up to 1 under half-up.
    expect(applyBps(iqd(5), bps(1_000))).toBe(1);
    // 10% of 4 = 0.4 → rounds down to 0.
    expect(applyBps(iqd(4), bps(1_000))).toBe(0);
  });

  it('returns zero commission for a zero rate and full amount for 100%', () => {
    expect(applyBps(iqd(50_000), bps(0))).toBe(0);
    expect(applyBps(iqd(50_000), bps(10_000))).toBe(50_000);
  });

  it('is deterministic across repeated application', () => {
    const base = iqd(1_234_567);
    const rate = bps(1_175);
    const first = applyBps(base, rate);
    for (let i = 0; i < 100; i += 1) {
      expect(applyBps(base, rate)).toBe(first);
    }
  });
});

describe('percentToBps() / bpsToPercentString()', () => {
  it('round-trips whole percentages', () => {
    expect(percentToBps(12)).toBe(1_200);
    expect(bpsToPercentString(bps(1_200))).toBe('12%');
    expect(bpsToPercentString(bps(2_000))).toBe('20%');
  });

  it('handles fractional percentages', () => {
    expect(percentToBps(12.5)).toBe(1_250);
    expect(bpsToPercentString(bps(1_250))).toBe('12.5%');
  });
});

describe('allocate()', () => {
  it('never loses or invents a dinar', () => {
    const parts = allocate(iqd(100), [1, 1, 1]);
    expect(parts).toEqual([34, 33, 33]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('respects weights', () => {
    const parts = allocate(iqd(1_000), [3, 1]);
    expect(parts).toEqual([750, 250]);
  });

  it('rejects degenerate weightings', () => {
    expect(() => allocate(iqd(100), [])).toThrow(MoneyError);
    expect(() => allocate(iqd(100), [0, 0])).toThrow(MoneyError);
    expect(() => allocate(iqd(100), [-1, 2])).toThrow(MoneyError);
  });
});

describe('subtractIqd()', () => {
  it('subtracts a list of amounts', () => {
    expect(subtractIqd(iqd(30_000), iqd(2_000), iqd(1_000))).toBe(27_000);
  });
});

describe('formatIqdArabic()', () => {
  it('renders grouped digits with the Arabic dinar suffix used in the designs', () => {
    expect(formatIqdArabic(iqd(31_000))).toBe('31,000 د.ع');
    expect(formatIqdArabic(iqd(0))).toBe('0 د.ع');
    expect(formatIqdArabic(iqd(342_000))).toBe('342,000 د.ع');
  });
});
