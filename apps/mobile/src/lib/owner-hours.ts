import type { OwnerWorkingHour } from './api';

/**
 * A shop's week, as the owner edits it on a phone.
 *
 * The portal's hours page is a table of fourteen time inputs, and the people
 * who open a market or a cosmetics shop do not have a schedule that needs
 * fourteen inputs: they open at the same time every day and close at the same
 * time every night, and perhaps Friday is different. So the week is edited
 * as one window applied to every open day, with a switch per day, and only
 * when that is not enough does it become seven rows.
 *
 * No React here; the arithmetic and the sentences are pinned by a test.
 */

export interface DayHours {
  /** 0 = Sunday … 6 = Saturday, as the API counts. */
  readonly day: number;
  /** Minutes from midnight, on a half-hour grid: 0 … 1410. */
  readonly opens: number;
  readonly closes: number;
  readonly closed: boolean;
}

export const DEFAULT_OPENS = 8 * 60;
export const DEFAULT_CLOSES = 23 * 60;
export const STEP_MINUTES = 30;
const DAY_MINUTES = 24 * 60;

export const DAY_NAMES_AR = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;

/** Two letters per day for the chips: the way Iraqi calendars abbreviate. */
export const DAY_SHORT_AR = ['أحد', 'اثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'] as const;

/** The windows most shops pick. One tap instead of twelve. */
export const PRESETS: readonly {
  readonly label: string;
  readonly opens: number;
  readonly closes: number;
}[] = [
  { label: '8 ص – 11 م', opens: 8 * 60, closes: 23 * 60 },
  { label: '9 ص – 12 ليلاً', opens: 9 * 60, closes: 0 },
  { label: '10 ص – 10 م', opens: 10 * 60, closes: 22 * 60 },
  { label: '24 ساعة', opens: 0, closes: 0 },
];

export function defaultWeek(): DayHours[] {
  return Array.from({ length: 7 }, (_, day) => ({
    day,
    opens: DEFAULT_OPENS,
    closes: DEFAULT_CLOSES,
    closed: false,
  }));
}

/** Snap a minute onto the half-hour grid and wrap it into one day. */
export function snapMinute(minute: number): number {
  const wrapped =
    (((Math.round(minute / STEP_MINUTES) * STEP_MINUTES) % DAY_MINUTES) + DAY_MINUTES) %
    DAY_MINUTES;
  return wrapped;
}

/** One step on the grid, wrapping past midnight in either direction. */
export function stepMinute(minute: number, direction: 1 | -1): number {
  return snapMinute(minute + direction * STEP_MINUTES);
}

/**
 * The week the server holds, as seven days.
 *
 * The API returns only the rows that exist; a day without a row is a day the
 * shop never opens. A shop with no rows at all has never been given hours,
 * and starts from the default week rather than from seven closed days.
 */
export function weekFromServer(rows: readonly OwnerWorkingHour[] | undefined): {
  week: DayHours[];
  configured: boolean;
} {
  if (!rows || rows.length === 0) return { week: defaultWeek(), configured: false };
  const byDay = new Map(rows.map((row) => [row.day_of_week, row]));
  return {
    configured: true,
    week: Array.from({ length: 7 }, (_, day) => {
      const row = byDay.get(day);
      if (!row) return { day, opens: DEFAULT_OPENS, closes: DEFAULT_CLOSES, closed: true };
      return {
        day,
        opens: snapMinute(row.opens_at_minute),
        // The API allows 1440 for midnight; on the grid that is 0 of the next day.
        closes: snapMinute(row.closes_at_minute),
        closed: row.is_closed,
      };
    }),
  };
}

/** Every open day keeps the same window — the shape most shops have. */
export function isUniform(week: readonly DayHours[]): boolean {
  const open = week.filter((day) => !day.closed);
  if (open.length === 0) return true;
  const [first] = open;
  return open.every((day) => day.opens === first!.opens && day.closes === first!.closes);
}

/** The one window a uniform week shares; the first open day's otherwise. */
export function sharedWindow(week: readonly DayHours[]): { opens: number; closes: number } {
  const first = week.find((day) => !day.closed) ?? week[0];
  return first
    ? { opens: first.opens, closes: first.closes }
    : { opens: DEFAULT_OPENS, closes: DEFAULT_CLOSES };
}

export function applyWindow(week: readonly DayHours[], opens: number, closes: number): DayHours[] {
  return week.map((day) => ({ ...day, opens, closes }));
}

export function setClosed(
  week: readonly DayHours[],
  dayIndex: number,
  closed: boolean,
): DayHours[] {
  return week.map((day) => (day.day === dayIndex ? { ...day, closed } : day));
}

export function setDayWindow(
  week: readonly DayHours[],
  dayIndex: number,
  patch: { opens?: number; closes?: number },
): DayHours[] {
  return week.map((day) => (day.day === dayIndex ? { ...day, ...patch } : day));
}

/** Closing at or before the opening minute means the shop closes after midnight. */
export function crossesMidnight(opens: number, closes: number): boolean {
  return closes <= opens;
}

/** The whole day, without a break: opens at midnight and closes at the next. */
export function isAllDay(opens: number, closes: number): boolean {
  return opens === 0 && closes === 0;
}

/** "8:00 ص", "11:30 م", midnight as "12:00 ص". Latin digits, as the rest of the app. */
export function formatTimeAr(minute: number): string {
  const normalised = snapMinute(minute);
  const hours24 = Math.floor(normalised / 60);
  const minutes = normalised % 60;
  const suffix = hours24 < 12 ? 'ص' : 'م';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/** "8:00 ص – 11:00 م", with a word when the night runs over. */
export function describeWindow(opens: number, closes: number): string {
  if (isAllDay(opens, closes)) return '24 ساعة';
  const range = `${formatTimeAr(opens)} – ${formatTimeAr(closes)}`;
  return crossesMidnight(opens, closes) ? `${range} (بعد منتصف الليل)` : range;
}

/** One line for the lobby and the settings row. */
export function summarizeWeek(week: readonly DayHours[]): string {
  const closedDays = week.filter((day) => day.closed);
  if (closedDays.length === 7) return 'مغلق كل الأيام';
  if (!isUniform(week)) return 'تختلف حسب اليوم';
  const { opens, closes } = sharedWindow(week);
  const window = describeWindow(opens, closes);
  if (closedDays.length === 0) return `يومياً ${window}`;
  const names = closedDays.map((day) => DAY_NAMES_AR[day.day]).join(' و');
  return `${window}، مغلق ${names}`;
}

/** What stops the week from being saved, in the owner's words. */
export function validateWeek(week: readonly DayHours[]): string | null {
  if (week.every((day) => day.closed)) return 'حدّد يوماً واحداً مفتوحاً على الأقل.';
  return null;
}

/**
 * The body `PUT /restaurant-portal/settings/working-hours` takes.
 *
 * A closed day is sent as a closed row rather than left out, so the week the
 * owner saw is the week the server holds. Closing "at midnight" is sent as
 * 1440 of the same day: the domain reads 0 as an overnight window ending at
 * midnight and 1440 as a same-day one, which are the same minutes, but 1440
 * keeps the portal's table from showing a shift that "crosses" into nothing.
 */
export function toPayload(week: readonly DayHours[]): {
  day_of_week: number;
  opens_at_minute: number;
  closes_at_minute: number;
  is_closed: boolean;
}[] {
  return week.map((day) => ({
    day_of_week: day.day,
    opens_at_minute: day.opens,
    closes_at_minute: day.closes === 0 ? DAY_MINUTES : day.closes,
    is_closed: day.closed,
  }));
}

/** Whether two weeks would save the same rows. */
export function sameWeek(a: readonly DayHours[], b: readonly DayHours[]): boolean {
  return (
    a.length === b.length &&
    a.every((day, index) => {
      const other = b[index];
      return (
        other !== undefined &&
        day.day === other.day &&
        day.closed === other.closed &&
        (day.closed || (day.opens === other.opens && day.closes === other.closes))
      );
    })
  );
}
