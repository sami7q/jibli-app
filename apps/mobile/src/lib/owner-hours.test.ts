import { describe, expect, it } from 'vitest';
import {
  applyWindow,
  defaultWeek,
  describeWindow,
  formatTimeAr,
  isUniform,
  sameWeek,
  setClosed,
  stepMinute,
  summarizeWeek,
  toPayload,
  validateWeek,
  weekFromServer,
} from './owner-hours';

const row = (day: number, opens: number, closes: number, closed = false) => ({
  id: `h${day}`,
  day_of_week: day,
  day_name_ar: '',
  opens_at: '',
  closes_at: '',
  opens_at_minute: opens,
  closes_at_minute: closes,
  is_closed: closed,
  is_overnight: closes < opens,
});

describe('weekFromServer', () => {
  it('starts an unconfigured shop on the default week, and says so', () => {
    const { week, configured } = weekFromServer([]);
    expect(configured).toBe(false);
    expect(week).toHaveLength(7);
    expect(week.every((day) => !day.closed && day.opens === 480 && day.closes === 1380)).toBe(true);
  });

  it('reads the rows it is given and closes the days it is not', () => {
    const { week, configured } = weekFromServer([row(0, 540, 1320), row(5, 540, 1320, true)]);
    expect(configured).toBe(true);
    expect(week[0]).toEqual({ day: 0, opens: 540, closes: 1320, closed: false });
    expect(week[5]?.closed).toBe(true);
    expect(week[1]?.closed).toBe(true);
  });

  it('puts a midnight close of 1440 on the grid as 0', () => {
    const { week } = weekFromServer([row(0, 600, 1440)]);
    expect(week[0]?.closes).toBe(0);
  });
});

describe('the clock', () => {
  it('steps on the half hour and wraps past midnight', () => {
    expect(stepMinute(1410, 1)).toBe(0);
    expect(stepMinute(0, -1)).toBe(1410);
    expect(stepMinute(480, 1)).toBe(510);
  });

  it('speaks twelve-hour Arabic', () => {
    expect(formatTimeAr(480)).toBe('8:00 ص');
    expect(formatTimeAr(1410)).toBe('11:30 م');
    expect(formatTimeAr(0)).toBe('12:00 ص');
    expect(formatTimeAr(720)).toBe('12:00 م');
  });

  it('names the window, and says when it runs past midnight', () => {
    expect(describeWindow(480, 1380)).toBe('8:00 ص – 11:00 م');
    expect(describeWindow(540, 0)).toBe('9:00 ص – 12:00 ص (بعد منتصف الليل)');
    expect(describeWindow(1080, 120)).toBe('6:00 م – 2:00 ص (بعد منتصف الليل)');
    expect(describeWindow(0, 0)).toBe('24 ساعة');
  });
});

describe('the week as one line', () => {
  it('is "daily" when every day shares the window', () => {
    expect(summarizeWeek(defaultWeek())).toBe('يومياً 8:00 ص – 11:00 م');
  });

  it('names the closed days of a uniform week', () => {
    const week = setClosed(defaultWeek(), 5, true);
    expect(summarizeWeek(week)).toBe('8:00 ص – 11:00 م، مغلق الجمعة');
  });

  it('gives up on a week that differs by day', () => {
    const week = applyWindow(defaultWeek(), 480, 1380).map((day) =>
      day.day === 3 ? { ...day, closes: 1200 } : day,
    );
    expect(isUniform(week)).toBe(false);
    expect(summarizeWeek(week)).toBe('تختلف حسب اليوم');
  });

  it('ignores the times of closed days when deciding uniformity', () => {
    const week = setClosed(defaultWeek(), 5, true).map((day) =>
      day.day === 5 ? { ...day, closes: 600 } : day,
    );
    expect(isUniform(week)).toBe(true);
  });
});

describe('saving', () => {
  it('refuses a week with no open day', () => {
    const allClosed = defaultWeek().map((day) => ({ ...day, closed: true }));
    expect(validateWeek(allClosed)).toMatch(/يوماً واحداً/);
    expect(validateWeek(defaultWeek())).toBeNull();
  });

  it('sends seven rows and writes midnight as 1440', () => {
    const payload = toPayload(applyWindow(defaultWeek(), 540, 0));
    expect(payload).toHaveLength(7);
    expect(payload[0]).toEqual({
      day_of_week: 0,
      opens_at_minute: 540,
      closes_at_minute: 1440,
      is_closed: false,
    });
  });

  it('keeps an overnight close as it is', () => {
    const payload = toPayload(applyWindow(defaultWeek(), 1080, 120));
    expect(payload[0]?.closes_at_minute).toBe(120);
  });

  it('knows when nothing changed', () => {
    const base = defaultWeek();
    expect(sameWeek(base, defaultWeek())).toBe(true);
    expect(sameWeek(base, setClosed(base, 5, true))).toBe(false);
    // A closed day's times do not count.
    const closedWithOtherTimes = setClosed(base, 5, true).map((day) =>
      day.day === 5 ? { ...day, opens: 0 } : day,
    );
    expect(sameWeek(setClosed(base, 5, true), closedWithOtherTimes)).toBe(true);
  });
});
