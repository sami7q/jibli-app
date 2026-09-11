import { BUSY_MODE_EXTRA_MINUTES, type BusyMode } from '@jibli/contracts';
import {
  BAGHDAD_TZ,
  businessDate,
  localDayOfWeek,
  minutesSinceLocalMidnight,
} from '../shared/time.js';

/**
 * Working-hour evaluation (plan §33, §105).
 *
 * "Working-hour calculation belongs in a single backend service. The mobile app
 * may display current state, but checkout and acceptance eligibility use server
 * time and server logic."
 *
 * Overnight ranges such as 18:00–02:00 are the interesting case: they are stored
 * with a close time numerically smaller than the open time, and an instant at
 * 01:00 belongs to the *previous* day's window.
 */

export interface WorkingHourRule {
  /** 0 = Sunday … 6 = Saturday, Baghdad local. */
  readonly dayOfWeek: number;
  readonly opensAtMinute: number;
  readonly closesAtMinute: number;
  readonly isClosed: boolean;
}

export interface HourException {
  /** Baghdad-local YYYY-MM-DD. */
  readonly localDate: string;
  readonly isClosed: boolean;
  readonly opensAtMinute: number | null;
  readonly closesAtMinute: number | null;
}

export interface OpenStateInput {
  readonly rules: readonly WorkingHourRule[];
  readonly exceptions?: readonly HourException[];
  readonly busyMode: BusyMode;
  readonly busyModeExpiresAt?: Date | null;
  readonly basePreparationMinutes: number;
  readonly now?: Date;
  readonly timeZone?: string;
}

export interface OpenState {
  readonly isOpen: boolean;
  /** True when hours allow orders but the branch has paused them (plan §33). */
  readonly isPaused: boolean;
  /** Hours + pause together: what checkout actually asks. */
  readonly acceptsOrders: boolean;
  readonly effectiveBusyMode: BusyMode;
  readonly estimatedPreparationMinutes: number;
  /** Why it is closed, for the Arabic empty state. */
  readonly reason: 'OPEN' | 'CLOSED_TODAY' | 'OUTSIDE_HOURS' | 'PAUSED' | 'NO_SCHEDULE';
}

/** A minute-of-day window, normalised so overnight ranges are explicit. */
interface Window {
  readonly openMinute: number;
  readonly closeMinute: number;
  /** True when the window crosses midnight into the next day. */
  readonly overnight: boolean;
  /** A zero-length window is a configuration error, treated as closed. */
  readonly empty: boolean;
}

function toWindow(open: number, close: number): Window {
  return {
    openMinute: open,
    closeMinute: close,
    overnight: close < open,
    // Never interpret open === close as "always open": that would silently keep
    // a misconfigured branch taking orders around the clock.
    empty: close === open,
  };
}

/**
 * Does *today's* rule cover this minute-of-day?
 *
 * A same-day window is a plain half-open range. An overnight window covers only
 * the part before midnight here — its early-morning tail belongs to the next
 * calendar day and is matched by `windowContainsFromYesterday` instead. Matching
 * both halves against today would make an 18:00–02:00 Monday rule claim Monday
 * 01:00, which is Sunday's shift.
 */
function windowContainsToday(window: Window, minuteOfDay: number): boolean {
  if (window.empty) return false;
  if (window.overnight) return minuteOfDay >= window.openMinute;
  return minuteOfDay >= window.openMinute && minuteOfDay < window.closeMinute;
}

/** The early-morning tail of an overnight window that opened yesterday. */
function windowContainsFromYesterday(window: Window, minuteOfDay: number): boolean {
  if (window.empty || !window.overnight) return false;
  return minuteOfDay < window.closeMinute;
}

/**
 * A branch is open at `now` if today's window contains it, OR yesterday's
 * overnight window has not closed yet.
 */
function resolveOpen(
  rules: readonly WorkingHourRule[],
  exceptions: readonly HourException[],
  now: Date,
  timeZone: string,
): { open: boolean; reason: OpenState['reason'] } {
  if (rules.length === 0) return { open: false, reason: 'NO_SCHEDULE' };

  const minuteOfDay = minutesSinceLocalMidnight(now, timeZone);
  const today = localDayOfWeek(now, timeZone);
  const yesterday = (today + 6) % 7;
  const todayDate = businessDate(now, timeZone);

  // A dated exception overrides the weekly schedule entirely (plan §105).
  const exception = exceptions.find((e) => e.localDate === todayDate);
  if (exception) {
    if (exception.isClosed) return { open: false, reason: 'CLOSED_TODAY' };
    if (exception.opensAtMinute !== null && exception.closesAtMinute !== null) {
      const window = toWindow(exception.opensAtMinute, exception.closesAtMinute);
      return windowContainsToday(window, minuteOfDay)
        ? { open: true, reason: 'OPEN' }
        : { open: false, reason: 'OUTSIDE_HOURS' };
    }
  }

  const todayRules = rules.filter((r) => r.dayOfWeek === today && !r.isClosed);
  for (const rule of todayRules) {
    if (windowContainsToday(toWindow(rule.opensAtMinute, rule.closesAtMinute), minuteOfDay)) {
      return { open: true, reason: 'OPEN' };
    }
  }

  // Yesterday's shift may still be running past midnight.
  const yesterdayRules = rules.filter((r) => r.dayOfWeek === yesterday && !r.isClosed);
  for (const rule of yesterdayRules) {
    if (
      windowContainsFromYesterday(toWindow(rule.opensAtMinute, rule.closesAtMinute), minuteOfDay)
    ) {
      return { open: true, reason: 'OPEN' };
    }
  }

  const hasAnyRuleToday = rules.some((r) => r.dayOfWeek === today && !r.isClosed);
  return { open: false, reason: hasAnyRuleToday ? 'OUTSIDE_HOURS' : 'CLOSED_TODAY' };
}

/**
 * Busy mode auto-expires so staff cannot accidentally leave a restaurant
 * unavailable all day (plan §33).
 */
export function effectiveBusyMode(
  busyMode: BusyMode,
  expiresAt: Date | null | undefined,
  now: Date,
): BusyMode {
  if (busyMode === 'NORMAL') return 'NORMAL';
  if (expiresAt && expiresAt.getTime() <= now.getTime()) return 'NORMAL';
  return busyMode;
}

export function evaluateOpenState(input: OpenStateInput): OpenState {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? BAGHDAD_TZ;

  const busyMode = effectiveBusyMode(input.busyMode, input.busyModeExpiresAt, now);
  const { open, reason } = resolveOpen(input.rules, input.exceptions ?? [], now, timeZone);
  const isPaused = busyMode === 'PAUSED';

  return {
    isOpen: open,
    isPaused,
    acceptsOrders: open && !isPaused,
    effectiveBusyMode: busyMode,
    estimatedPreparationMinutes:
      input.basePreparationMinutes + (BUSY_MODE_EXTRA_MINUTES[busyMode] ?? 0),
    reason: isPaused && open ? 'PAUSED' : reason,
  };
}

/** "18:00" from 1080 — for the Arabic hours editor. */
export function formatMinuteOfDay(minute: number): string {
  const normalised = ((minute % 1440) + 1440) % 1440;
  const hours = Math.floor(normalised / 60);
  const minutes = normalised % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function parseMinuteOfDay(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid time of day: ${value}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) {
    throw new Error(`Invalid time of day: ${value}`);
  }
  return hours * 60 + minutes;
}

/** Arabic weekday names, indexed 0 = Sunday to match localDayOfWeek. */
export const WEEKDAY_NAMES_AR = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;
