import { describe, expect, it } from 'vitest';
import { describeWeekAr, describeWindowAr } from './hours-summary';

const rule = (
  dayOfWeek: number,
  opensAtMinute: number,
  closesAtMinute: number,
  isClosed = false,
) => ({
  dayOfWeek,
  opensAtMinute,
  closesAtMinute,
  isClosed,
});

const week = (opens: number, closes: number, closedDays: number[] = []) =>
  Array.from({ length: 7 }, (_, day) => rule(day, opens, closes, closedDays.includes(day)));

describe('describeWeekAr', () => {
  it('says so when there are no hours at all', () => {
    expect(describeWeekAr([])).toBe('لم تُضبط');
  });

  it('is "daily" for one window on every day', () => {
    expect(describeWeekAr(week(480, 1380))).toBe('يومياً 08:00–23:00');
  });

  it('names the closed days, including days with no row', () => {
    expect(describeWeekAr(week(480, 1380, [5]))).toBe('08:00–23:00، مغلق الجمعة');
    expect(describeWeekAr(week(480, 1380).filter((entry) => entry.dayOfWeek !== 6))).toBe(
      '08:00–23:00، مغلق السبت',
    );
  });

  it('gives up on a week whose days differ', () => {
    const mixed = week(480, 1380).map((entry) =>
      entry.dayOfWeek === 2 ? { ...entry, closesAtMinute: 1200 } : entry,
    );
    expect(describeWeekAr(mixed)).toBe('تختلف حسب اليوم');
  });

  it('ignores the times of closed days', () => {
    const friday = week(480, 1380, [5]).map((entry) =>
      entry.dayOfWeek === 5 ? { ...entry, opensAtMinute: 0 } : entry,
    );
    expect(describeWeekAr(friday)).toBe('08:00–23:00، مغلق الجمعة');
  });

  it('is closed when every day is', () => {
    expect(describeWeekAr(week(480, 1380, [0, 1, 2, 3, 4, 5, 6]))).toBe('مغلق كل الأيام');
  });
});

describe('describeWindowAr', () => {
  it('writes midnight as 00:00 and marks an overnight shift', () => {
    expect(describeWindowAr(540, 1440)).toBe('09:00–00:00');
    expect(describeWindowAr(1080, 120)).toBe('18:00–02:00 (بعد منتصف الليل)');
    expect(describeWindowAr(0, 1440)).toBe('24 ساعة');
  });
});
