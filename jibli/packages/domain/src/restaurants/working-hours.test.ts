import { describe, expect, it } from 'vitest';
import {
  effectiveBusyMode,
  evaluateOpenState,
  formatMinuteOfDay,
  parseMinuteOfDay,
  type WorkingHourRule,
} from './working-hours.js';
import { zonedTimeToUtc } from '../shared/time.js';

const baghdad = (y: number, m: number, d: number, h = 0, min = 0) =>
  zonedTimeToUtc(y, m, d, h, min, 0);

const hours = (dayOfWeek: number, open: string, close: string): WorkingHourRule => ({
  dayOfWeek,
  opensAtMinute: parseMinuteOfDay(open),
  closesAtMinute: parseMinuteOfDay(close),
  isClosed: false,
});

const base = {
  busyMode: 'NORMAL' as const,
  basePreparationMinutes: 30,
};

// 2025-08-11 is a Monday (dayOfWeek 1); 2025-08-10 is a Sunday (0).
const MONDAY = { y: 2025, m: 8, d: 11, dow: 1 };
const SUNDAY = { y: 2025, m: 8, d: 10, dow: 0 };

describe('same-day hours', () => {
  const rules = [hours(MONDAY.dow, '10:00', '23:00')];

  it('is open inside the window', () => {
    const state = evaluateOpenState({
      ...base,
      rules,
      now: baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 14, 0),
    });
    expect(state.isOpen).toBe(true);
    expect(state.acceptsOrders).toBe(true);
    expect(state.reason).toBe('OPEN');
  });

  it('is open exactly at opening minute', () => {
    expect(
      evaluateOpenState({ ...base, rules, now: baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 10, 0) })
        .isOpen,
    ).toBe(true);
  });

  it('is closed exactly at closing minute — the range is half-open', () => {
    expect(
      evaluateOpenState({ ...base, rules, now: baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 23, 0) })
        .isOpen,
    ).toBe(false);
  });

  it('is closed before opening', () => {
    const state = evaluateOpenState({
      ...base,
      rules,
      now: baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 9, 59),
    });
    expect(state.isOpen).toBe(false);
    expect(state.reason).toBe('OUTSIDE_HOURS');
  });

  it('is closed on a day with no rule', () => {
    const state = evaluateOpenState({
      ...base,
      rules,
      now: baghdad(SUNDAY.y, SUNDAY.m, SUNDAY.d, 14, 0),
    });
    expect(state.isOpen).toBe(false);
    expect(state.reason).toBe('CLOSED_TODAY');
  });
});

describe('overnight hours 18:00–02:00 (plan §33, §105)', () => {
  // Open Sunday and Monday evenings, each running to 02:00 the next morning.
  const rules = [hours(SUNDAY.dow, '18:00', '02:00'), hours(MONDAY.dow, '18:00', '02:00')];

  it('is open at 20:00 on the opening day', () => {
    expect(
      evaluateOpenState({ ...base, rules, now: baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 20, 0) })
        .isOpen,
    ).toBe(true);
  });

  it('is open at 23:59 on the opening day', () => {
    expect(
      evaluateOpenState({ ...base, rules, now: baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 23, 59) })
        .isOpen,
    ).toBe(true);
  });

  it('is still open at 01:00 — past midnight, on the previous day’s shift', () => {
    // 01:00 Monday belongs to Sunday's 18:00–02:00 window.
    expect(
      evaluateOpenState({ ...base, rules, now: baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 1, 0) })
        .isOpen,
    ).toBe(true);
  });

  it('is closed at 02:00 — the overnight window has ended', () => {
    expect(
      evaluateOpenState({ ...base, rules, now: baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 2, 0) })
        .isOpen,
    ).toBe(false);
  });

  it('is closed at 10:00, between shifts', () => {
    expect(
      evaluateOpenState({ ...base, rules, now: baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 10, 0) })
        .isOpen,
    ).toBe(false);
  });

  it('does not carry over from a day that has no overnight rule', () => {
    // Only Monday is open overnight; Tuesday 01:00 draws on Monday's window…
    const mondayOnly = [hours(MONDAY.dow, '18:00', '02:00')];
    expect(
      evaluateOpenState({
        ...base,
        rules: mondayOnly,
        now: baghdad(2025, 8, 12, 1, 0), // Tuesday 01:00
      }).isOpen,
    ).toBe(true);
    // …but Monday 01:00 would need Sunday, which has no rule here.
    expect(
      evaluateOpenState({
        ...base,
        rules: mondayOnly,
        now: baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 1, 0),
      }).isOpen,
    ).toBe(false);
  });
});

describe('split shifts in one day', () => {
  const rules = [hours(MONDAY.dow, '08:00', '15:00'), hours(MONDAY.dow, '18:00', '23:00')];

  it('is open during the morning shift', () => {
    expect(
      evaluateOpenState({ ...base, rules, now: baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 9) }).isOpen,
    ).toBe(true);
  });

  it('is closed during the afternoon break', () => {
    expect(
      evaluateOpenState({ ...base, rules, now: baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 16) }).isOpen,
    ).toBe(false);
  });

  it('is open again in the evening', () => {
    expect(
      evaluateOpenState({ ...base, rules, now: baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 20) }).isOpen,
    ).toBe(true);
  });
});

describe('dated exceptions override the weekly schedule (plan §105)', () => {
  const rules = [hours(MONDAY.dow, '10:00', '23:00')];

  it('closes the branch for a holiday', () => {
    const state = evaluateOpenState({
      ...base,
      rules,
      exceptions: [
        { localDate: '2025-08-11', isClosed: true, opensAtMinute: null, closesAtMinute: null },
      ],
      now: baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 14),
    });
    expect(state.isOpen).toBe(false);
    expect(state.reason).toBe('CLOSED_TODAY');
  });

  it('applies special hours for a day', () => {
    const exceptions = [
      {
        localDate: '2025-08-11',
        isClosed: false,
        opensAtMinute: parseMinuteOfDay('12:00'),
        closesAtMinute: parseMinuteOfDay('16:00'),
      },
    ];
    expect(
      evaluateOpenState({
        ...base,
        rules,
        exceptions,
        now: baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 11),
      }).isOpen,
    ).toBe(false);
    expect(
      evaluateOpenState({
        ...base,
        rules,
        exceptions,
        now: baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 13),
      }).isOpen,
    ).toBe(true);
  });

  it('ignores an exception for a different date', () => {
    expect(
      evaluateOpenState({
        ...base,
        rules,
        exceptions: [
          { localDate: '2025-08-12', isClosed: true, opensAtMinute: null, closesAtMinute: null },
        ],
        now: baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 14),
      }).isOpen,
    ).toBe(true);
  });
});

describe('busy mode (plan §33)', () => {
  const rules = [hours(MONDAY.dow, '10:00', '23:00')];
  const now = baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 14);

  it('adds 15 minutes when busy', () => {
    const state = evaluateOpenState({ ...base, rules, now, busyMode: 'BUSY' });
    expect(state.estimatedPreparationMinutes).toBe(45);
    expect(state.acceptsOrders).toBe(true);
  });

  it('adds 30 minutes when very busy', () => {
    expect(
      evaluateOpenState({ ...base, rules, now, busyMode: 'VERY_BUSY' })
        .estimatedPreparationMinutes,
    ).toBe(60);
  });

  it('stops new orders when paused, while remaining open', () => {
    const state = evaluateOpenState({ ...base, rules, now, busyMode: 'PAUSED' });
    expect(state.isOpen).toBe(true);
    expect(state.isPaused).toBe(true);
    expect(state.acceptsOrders).toBe(false);
    expect(state.reason).toBe('PAUSED');
  });

  it('auto-expires so staff cannot leave the branch paused all day', () => {
    const state = evaluateOpenState({
      ...base,
      rules,
      now,
      busyMode: 'PAUSED',
      busyModeExpiresAt: baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 13), // expired an hour ago
    });
    expect(state.effectiveBusyMode).toBe('NORMAL');
    expect(state.acceptsOrders).toBe(true);
  });

  it('honours busy mode that has not expired yet', () => {
    const state = evaluateOpenState({
      ...base,
      rules,
      now,
      busyMode: 'VERY_BUSY',
      busyModeExpiresAt: baghdad(MONDAY.y, MONDAY.m, MONDAY.d, 15),
    });
    expect(state.effectiveBusyMode).toBe('VERY_BUSY');
  });
});

describe('effectiveBusyMode()', () => {
  const now = baghdad(2025, 8, 11, 14);

  it('leaves NORMAL alone regardless of expiry', () => {
    expect(effectiveBusyMode('NORMAL', null, now)).toBe('NORMAL');
  });

  it('keeps a mode with no expiry set', () => {
    expect(effectiveBusyMode('BUSY', null, now)).toBe('BUSY');
  });
});

describe('no schedule configured', () => {
  it('is closed and says so distinctly, so onboarding can flag it', () => {
    const state = evaluateOpenState({ ...base, rules: [], now: baghdad(2025, 8, 11, 14) });
    expect(state.isOpen).toBe(false);
    expect(state.reason).toBe('NO_SCHEDULE');
  });
});

describe('minute-of-day formatting', () => {
  it('formats and parses round-trip', () => {
    expect(formatMinuteOfDay(0)).toBe('00:00');
    expect(formatMinuteOfDay(1080)).toBe('18:00');
    expect(formatMinuteOfDay(1439)).toBe('23:59');
    expect(parseMinuteOfDay('18:00')).toBe(1080);
    expect(parseMinuteOfDay('00:00')).toBe(0);
    expect(parseMinuteOfDay('24:00')).toBe(1440);
  });

  it('rejects malformed input', () => {
    expect(() => parseMinuteOfDay('25:00')).toThrow();
    expect(() => parseMinuteOfDay('12:60')).toThrow();
    expect(() => parseMinuteOfDay('noon')).toThrow();
  });
});
