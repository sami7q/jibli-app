import type { SettlementPolicy } from '@jibli/contracts';
import { BAGHDAD_TZ, toZonedParts, zonedTimeToUtc } from '../shared/time.js';

/**
 * Settlement periods (plan §40, §102).
 *
 * Half-month:
 *   Period 1: day 1 inclusive to day 16 exclusive
 *   Period 2: day 16 inclusive to the 1st of next month exclusive
 * Monthly:
 *   1st inclusive to the 1st of next month exclusive
 *
 * Ranges are half-open [start, end) so there is no 23:59:59 to get wrong, and
 * no instant can belong to two periods or to none. Boundaries are Baghdad
 * wall-clock, converted to UTC for querying.
 */

export interface SettlementPeriod {
  /** Inclusive lower bound, UTC. */
  readonly start: Date;
  /** Exclusive upper bound, UTC. */
  readonly end: Date;
  readonly policy: SettlementPolicy;
  /** Stable identifier, e.g. "2025-08-H1" or "2025-08-M". */
  readonly label: string;
  /** Arabic label for statements, e.g. "1 - 15 آب 2025". */
  readonly labelAr: string;
}

/** Arabic month names as used on Iraqi statements. */
const ARABIC_MONTHS = [
  'كانون الثاني',
  'شباط',
  'آذار',
  'نيسان',
  'أيار',
  'حزيران',
  'تموز',
  'آب',
  'أيلول',
  'تشرين الأول',
  'تشرين الثاني',
  'كانون الأول',
] as const;

function monthNameAr(month: number): string {
  return ARABIC_MONTHS[month - 1] ?? String(month);
}

/** First instant of the month after (year, month), as a Baghdad-local boundary. */
function firstOfNextMonth(year: number, month: number, timeZone: string): Date {
  return month === 12
    ? zonedTimeToUtc(year + 1, 1, 1, 0, 0, 0, timeZone)
    : zonedTimeToUtc(year, month + 1, 1, 0, 0, 0, timeZone);
}

/** Last calendar day of a month — correct for leap years. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The period an instant belongs to.
 *
 * Settlement membership is decided by an order's `completed_at` (plan §102), so
 * this is called with that timestamp.
 */
export function periodFor(
  instant: Date,
  policy: SettlementPolicy,
  timeZone: string = BAGHDAD_TZ,
): SettlementPeriod {
  const { year, month, day } = toZonedParts(instant, timeZone);

  if (policy === 'MONTHLY') {
    return {
      start: zonedTimeToUtc(year, month, 1, 0, 0, 0, timeZone),
      end: firstOfNextMonth(year, month, timeZone),
      policy,
      label: `${year}-${String(month).padStart(2, '0')}-M`,
      labelAr: `${monthNameAr(month)} ${year}`,
    };
  }

  // Half-month. Day 16 is the boundary: it opens the second period.
  if (day < 16) {
    return {
      start: zonedTimeToUtc(year, month, 1, 0, 0, 0, timeZone),
      end: zonedTimeToUtc(year, month, 16, 0, 0, 0, timeZone),
      policy,
      label: `${year}-${String(month).padStart(2, '0')}-H1`,
      labelAr: `1 - 15 ${monthNameAr(month)} ${year}`,
    };
  }

  return {
    start: zonedTimeToUtc(year, month, 16, 0, 0, 0, timeZone),
    end: firstOfNextMonth(year, month, timeZone),
    policy,
    label: `${year}-${String(month).padStart(2, '0')}-H2`,
    labelAr: `16 - ${daysInMonth(year, month)} ${monthNameAr(month)} ${year}`,
  };
}

/**
 * The period immediately before the one containing `instant` — what a scheduled
 * job settles when it runs after a period closes.
 */
export function previousPeriod(
  instant: Date,
  policy: SettlementPolicy,
  timeZone: string = BAGHDAD_TZ,
): SettlementPeriod {
  const current = periodFor(instant, policy, timeZone);
  // One millisecond before the current period starts is inside the previous one.
  return periodFor(new Date(current.start.getTime() - 1), policy, timeZone);
}

export function nextPeriod(
  instant: Date,
  policy: SettlementPolicy,
  timeZone: string = BAGHDAD_TZ,
): SettlementPeriod {
  const current = periodFor(instant, policy, timeZone);
  return periodFor(current.end, policy, timeZone);
}

/** Half-open containment: start <= instant < end. */
export function periodContains(period: SettlementPeriod, instant: Date): boolean {
  return instant.getTime() >= period.start.getTime() && instant.getTime() < period.end.getTime();
}

/** Every period between two instants, for backfills and reports. */
export function periodsBetween(
  from: Date,
  to: Date,
  policy: SettlementPolicy,
  timeZone: string = BAGHDAD_TZ,
): SettlementPeriod[] {
  const periods: SettlementPeriod[] = [];
  let cursor = periodFor(from, policy, timeZone);
  // Guard against a malformed range producing an unbounded loop.
  let guard = 0;
  while (cursor.start.getTime() < to.getTime() && guard < 10_000) {
    periods.push(cursor);
    cursor = periodFor(cursor.end, policy, timeZone);
    guard += 1;
  }
  return periods;
}

/** Due date for a statement, derived from the restaurant's payment terms. */
export function dueDateFor(issuedAt: Date, paymentTermDays: number): Date {
  return new Date(issuedAt.getTime() + paymentTermDays * 24 * 60 * 60 * 1000);
}
