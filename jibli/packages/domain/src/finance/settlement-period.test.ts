import { describe, expect, it } from 'vitest';
import {
  daysInMonth,
  dueDateFor,
  nextPeriod,
  periodContains,
  periodFor,
  periodsBetween,
  previousPeriod,
} from './settlement-period.js';
import { businessDate, zonedTimeToUtc } from '../shared/time.js';

/** Baghdad wall-clock helper: Iraq is UTC+3 with no DST, so 00:00 local = 21:00Z prior day. */
const baghdad = (y: number, m: number, d: number, h = 0, min = 0) =>
  zonedTimeToUtc(y, m, d, h, min, 0);

describe('zonedTimeToUtc() — Baghdad is UTC+3', () => {
  it('maps local midnight to 21:00Z the previous day', () => {
    expect(baghdad(2025, 8, 1).toISOString()).toBe('2025-07-31T21:00:00.000Z');
  });

  it('maps local noon to 09:00Z', () => {
    expect(baghdad(2025, 8, 15, 12).toISOString()).toBe('2025-08-15T09:00:00.000Z');
  });

  it('round-trips through businessDate', () => {
    expect(businessDate(baghdad(2025, 8, 1))).toBe('2025-08-01');
    // 22:00Z on 31 July is already 01:00 on 1 August in Baghdad.
    expect(businessDate(new Date('2025-07-31T22:00:00Z'))).toBe('2025-08-01');
  });
});

describe('half-month periods (plan §40)', () => {
  it('puts day 1 in the first period: [1, 16)', () => {
    const period = periodFor(baghdad(2025, 8, 1, 0, 0), 'HALF_MONTH');
    expect(period.start.toISOString()).toBe(baghdad(2025, 8, 1).toISOString());
    expect(period.end.toISOString()).toBe(baghdad(2025, 8, 16).toISOString());
    expect(period.label).toBe('2025-08-H1');
  });

  it('puts day 15 at 23:59 still in the first period', () => {
    expect(periodFor(baghdad(2025, 8, 15, 23, 59), 'HALF_MONTH').label).toBe('2025-08-H1');
  });

  it('puts day 16 at 00:00 in the second period — the boundary opens it', () => {
    const period = periodFor(baghdad(2025, 8, 16, 0, 0), 'HALF_MONTH');
    expect(period.label).toBe('2025-08-H2');
    expect(period.start.toISOString()).toBe(baghdad(2025, 8, 16).toISOString());
    expect(period.end.toISOString()).toBe(baghdad(2025, 9, 1).toISOString());
  });

  it('ends the second period at the first of next month, exclusive', () => {
    const period = periodFor(baghdad(2025, 8, 31, 23, 59), 'HALF_MONTH');
    expect(period.end.toISOString()).toBe(baghdad(2025, 9, 1).toISOString());
  });

  it('never leaves a gap or an overlap at the boundary', () => {
    const first = periodFor(baghdad(2025, 8, 10), 'HALF_MONTH');
    const second = periodFor(baghdad(2025, 8, 20), 'HALF_MONTH');
    expect(first.end.getTime()).toBe(second.start.getTime());

    // The exact boundary instant belongs to exactly one period.
    const boundary = baghdad(2025, 8, 16);
    expect(periodContains(first, boundary)).toBe(false);
    expect(periodContains(second, boundary)).toBe(true);
  });
});

describe('monthly periods', () => {
  it('spans the whole calendar month, half-open', () => {
    const period = periodFor(baghdad(2025, 8, 20), 'MONTHLY');
    expect(period.start.toISOString()).toBe(baghdad(2025, 8, 1).toISOString());
    expect(period.end.toISOString()).toBe(baghdad(2025, 9, 1).toISOString());
    expect(period.label).toBe('2025-08-M');
  });

  it('rolls the year over correctly in December', () => {
    const period = periodFor(baghdad(2025, 12, 31, 23, 59), 'MONTHLY');
    expect(period.end.toISOString()).toBe(baghdad(2026, 1, 1).toISOString());
  });
});

describe('month lengths (plan §102: 28, 29, 30, 31 days)', () => {
  it('handles February in a common year', () => {
    expect(daysInMonth(2025, 2)).toBe(28);
    const period = periodFor(baghdad(2025, 2, 20), 'HALF_MONTH');
    expect(period.end.toISOString()).toBe(baghdad(2025, 3, 1).toISOString());
    expect(period.labelAr).toContain('16 - 28');
  });

  it('handles February in a leap year', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    const period = periodFor(baghdad(2024, 2, 29, 23, 0), 'HALF_MONTH');
    expect(period.end.toISOString()).toBe(baghdad(2024, 3, 1).toISOString());
    expect(period.labelAr).toContain('16 - 29');
  });

  it('handles 30- and 31-day months', () => {
    expect(daysInMonth(2025, 4)).toBe(30);
    expect(daysInMonth(2025, 1)).toBe(31);
    expect(periodFor(baghdad(2025, 4, 30, 23, 59), 'HALF_MONTH').end.toISOString()).toBe(
      baghdad(2025, 5, 1).toISOString(),
    );
  });
});

describe('year boundary (plan §102)', () => {
  it('crosses from December H2 into January H1', () => {
    const december = periodFor(baghdad(2025, 12, 20), 'HALF_MONTH');
    const january = periodFor(baghdad(2026, 1, 5), 'HALF_MONTH');
    expect(december.label).toBe('2025-12-H2');
    expect(january.label).toBe('2026-01-H1');
    expect(december.end.getTime()).toBe(january.start.getTime());
  });
});

describe('previousPeriod() / nextPeriod()', () => {
  it('walks back across a half-month boundary', () => {
    expect(previousPeriod(baghdad(2025, 8, 20), 'HALF_MONTH').label).toBe('2025-08-H1');
    expect(previousPeriod(baghdad(2025, 8, 5), 'HALF_MONTH').label).toBe('2025-07-H2');
  });

  it('walks back across a year boundary', () => {
    expect(previousPeriod(baghdad(2026, 1, 5), 'HALF_MONTH').label).toBe('2025-12-H2');
    expect(previousPeriod(baghdad(2026, 1, 5), 'MONTHLY').label).toBe('2025-12-M');
  });

  it('walks forward', () => {
    expect(nextPeriod(baghdad(2025, 8, 5), 'HALF_MONTH').label).toBe('2025-08-H2');
    expect(nextPeriod(baghdad(2025, 12, 20), 'HALF_MONTH').label).toBe('2026-01-H1');
  });

  it('is the inverse of nextPeriod', () => {
    const start = baghdad(2025, 5, 10);
    const forward = nextPeriod(start, 'HALF_MONTH');
    expect(previousPeriod(forward.start, 'HALF_MONTH').label).toBe(
      periodFor(start, 'HALF_MONTH').label,
    );
  });
});

describe('periodsBetween()', () => {
  it('enumerates every half-month in a quarter', () => {
    const periods = periodsBetween(baghdad(2025, 1, 1), baghdad(2025, 4, 1), 'HALF_MONTH');
    expect(periods.map((p) => p.label)).toEqual([
      '2025-01-H1',
      '2025-01-H2',
      '2025-02-H1',
      '2025-02-H2',
      '2025-03-H1',
      '2025-03-H2',
    ]);
  });

  it('returns nothing for an inverted range rather than looping', () => {
    expect(periodsBetween(baghdad(2025, 4, 1), baghdad(2025, 1, 1), 'MONTHLY')).toEqual([]);
  });
});

describe('order completed exactly at a settlement boundary (plan §102)', () => {
  it('assigns an order completed at 23:59:59 on day 15 to H1', () => {
    const completedAt = baghdad(2025, 8, 15, 23, 59);
    expect(periodFor(completedAt, 'HALF_MONTH').label).toBe('2025-08-H1');
  });

  it('assigns an order completed at 00:00:00 on day 16 to H2', () => {
    const completedAt = baghdad(2025, 8, 16, 0, 0);
    expect(periodFor(completedAt, 'HALF_MONTH').label).toBe('2025-08-H2');
  });

  it('uses Baghdad time, not UTC, to decide the boundary', () => {
    // 21:30Z on 15 August is already 00:30 on 16 August in Baghdad, so this
    // order belongs to H2 even though UTC still says the 15th.
    const completedAt = new Date('2025-08-15T21:30:00Z');
    expect(businessDate(completedAt)).toBe('2025-08-16');
    expect(periodFor(completedAt, 'HALF_MONTH').label).toBe('2025-08-H2');
  });
});

describe('Arabic period labels', () => {
  it('names the month in Arabic for statements', () => {
    expect(periodFor(baghdad(2025, 8, 5), 'HALF_MONTH').labelAr).toBe('1 - 15 آب 2025');
    expect(periodFor(baghdad(2025, 1, 5), 'MONTHLY').labelAr).toBe('كانون الثاني 2025');
  });
});

describe('dueDateFor()', () => {
  it('adds the contractual payment term', () => {
    const issued = baghdad(2025, 8, 16, 10);
    expect(dueDateFor(issued, 7).toISOString()).toBe(baghdad(2025, 8, 23, 10).toISOString());
  });

  it('supports immediate terms', () => {
    const issued = baghdad(2025, 8, 16, 10);
    expect(dueDateFor(issued, 0).getTime()).toBe(issued.getTime());
  });
});
