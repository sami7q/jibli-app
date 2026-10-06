import { describe, expect, it } from 'vitest';
import { AppError } from '@jibli/contracts';
import {
  AssertionFailed,
  baghdad,
  baghdadDayOfWeek,
  baghdadMinuteOfDay,
  expectAppError,
  expectRejectsAppError,
  FakeClock,
  idSequence,
  uuidSequence,
} from './index.js';

/**
 * These helpers exist to make other tests fail honestly, so their own failure
 * modes are the thing worth testing: a helper that passes when nothing threw
 * would quietly disarm every suite that uses it.
 */

describe('expectAppError()', () => {
  it('returns the error so details can be asserted on', () => {
    const error = expectAppError(() => {
      throw new AppError('ITEM_UNAVAILABLE', { details: { nameAr: 'دولمة' } });
    }, 'ITEM_UNAVAILABLE');

    expect(error.details).toMatchObject({ nameAr: 'دولمة' });
  });

  it('fails when nothing throws — the trap the hand-written pattern falls into', () => {
    expect(() => expectAppError(() => 'fine', 'ITEM_UNAVAILABLE')).toThrow(AssertionFailed);
  });

  it('fails when a different code is thrown', () => {
    expect(() =>
      expectAppError(() => {
        throw new AppError('NOT_FOUND');
      }, 'ITEM_UNAVAILABLE'),
    ).toThrow(/expected AppError code ITEM_UNAVAILABLE, got NOT_FOUND/);
  });

  it('fails when a plain Error is thrown, and names it', () => {
    expect(() =>
      expectAppError(() => {
        throw new TypeError('boom');
      }, 'ITEM_UNAVAILABLE'),
    ).toThrow(/got TypeError: boom/);
  });
});

describe('expectRejectsAppError()', () => {
  it('accepts a promise', async () => {
    const error = await expectRejectsAppError(Promise.reject(new AppError('CONFLICT')), 'CONFLICT');
    expect(error.code).toBe('CONFLICT');
  });

  it('accepts a thunk', async () => {
    const error = await expectRejectsAppError(async () => {
      throw new AppError('CONFLICT');
    }, 'CONFLICT');
    expect(error.code).toBe('CONFLICT');
  });

  it('fails when the promise resolves', async () => {
    await expect(expectRejectsAppError(Promise.resolve('fine'), 'CONFLICT')).rejects.toThrow(
      AssertionFailed,
    );
  });
});

describe('baghdad()', () => {
  it('reads as a Baghdad wall clock, three hours ahead of UTC', () => {
    // 18:30 in Baghdad is 15:30 UTC, all year — the zone has no DST.
    expect(baghdad(2026, 3, 15, 18, 30).toISOString()).toBe('2026-03-15T15:30:00.000Z');
    expect(baghdad(2026, 7, 15, 18, 30).toISOString()).toBe('2026-07-15T15:30:00.000Z');
  });

  it('takes a 1-based month, matching a calendar rather than Date', () => {
    expect(baghdad(2026, 1, 1, 3).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rolls back across midnight when the Baghdad hour is before 03:00', () => {
    expect(baghdad(2026, 3, 15, 1, 0).toISOString()).toBe('2026-03-14T22:00:00.000Z');
  });

  it('derives minute-of-day and weekday in Baghdad, not the host zone', () => {
    const instant = baghdad(2026, 3, 15, 18, 30);
    expect(baghdadMinuteOfDay(instant)).toBe(18 * 60 + 30);
    // 15 March 2026 is a Sunday.
    expect(baghdadDayOfWeek(instant)).toBe(0);
  });

  it('places a post-midnight instant on the following Baghdad day', () => {
    const instant = baghdad(2026, 3, 16, 1, 0);
    expect(baghdadMinuteOfDay(instant)).toBe(60);
    expect(baghdadDayOfWeek(instant)).toBe(1);
  });
});

describe('FakeClock', () => {
  it('hands out a copy, so a caller cannot mutate the clock', () => {
    const clock = new FakeClock(baghdad(2026, 3, 15, 12));
    const first = clock.now();
    first.setUTCFullYear(1999);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it('advances by minutes and days', () => {
    const clock = new FakeClock(baghdad(2026, 3, 15, 12));
    clock.advanceMinutes(90).advanceDays(1);
    expect(clock.now().toISOString()).toBe(baghdad(2026, 3, 16, 13, 30).toISOString());
  });

  it('refuses to run backwards', () => {
    const clock = new FakeClock(baghdad(2026, 3, 15, 12));
    expect(() => clock.advance(-1)).toThrow(/backwards/);
  });
});

describe('id helpers', () => {
  it('numbers ids so a failure names a recognisable row', () => {
    const nextId = idSequence('order');
    expect([nextId(), nextId(), nextId()]).toEqual(['order-1', 'order-2', 'order-3']);
  });

  it('produces distinct, ordered, well-formed UUIDs', () => {
    const nextUuid = uuidSequence();
    const first = nextUuid();
    const second = nextUuid();

    expect(first).not.toBe(second);
    expect(first < second).toBe(true);
    for (const value of [first, second]) {
      expect(value).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it('lets a seed keep two sequences from colliding', () => {
    const orders = uuidSequence(0);
    const drivers = uuidSequence(1_000);
    expect(orders()).not.toBe(drivers());
  });
});
