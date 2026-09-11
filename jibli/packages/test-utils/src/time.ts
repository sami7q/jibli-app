/**
 * Deterministic time for tests.
 *
 * Everything in this system that depends on "now" — settlement periods, working
 * hours, busy-mode expiry, SLA timers — is defined in Asia/Baghdad, a zone with
 * no daylight saving. A test that builds dates from the machine's local zone
 * passes in Baghdad and fails in CI, so these helpers construct instants from an
 * explicit Baghdad wall-clock reading instead.
 *
 * Baghdad is UTC+3 year-round. That is stated as a constant rather than derived,
 * because deriving it would mean trusting the host's tz database in the very
 * place a test is meant to pin the behaviour down.
 */

export const BAGHDAD_UTC_OFFSET_HOURS = 3;

/**
 * An instant, given as a Baghdad wall-clock reading.
 *
 * `baghdad(2026, 3, 15, 18, 30)` is 18:30 on 15 March 2026 in Baghdad, which is
 * 15:30 UTC. Month is 1-based, unlike `Date`, because every caller here reads
 * off a calendar rather than a zero-indexed array.
 */
export function baghdad(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  return new Date(
    Date.UTC(year, month - 1, day, hour - BAGHDAD_UTC_OFFSET_HOURS, minute, second),
  );
}

/** Minutes since Baghdad midnight — the unit working-hours rules are stored in. */
export function baghdadMinuteOfDay(instant: Date): number {
  const shifted = new Date(instant.getTime() + BAGHDAD_UTC_OFFSET_HOURS * 3_600_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** Day of week in Baghdad, 0 = Sunday, matching the working-hours schema. */
export function baghdadDayOfWeek(instant: Date): number {
  const shifted = new Date(instant.getTime() + BAGHDAD_UTC_OFFSET_HOURS * 3_600_000);
  return shifted.getUTCDay();
}

/**
 * A clock a test controls.
 *
 * Passed wherever production code takes a `now` argument. Nothing here patches
 * globals: a test that replaces `Date.now` leaks into whatever runs next in the
 * same worker, and the failure surfaces somewhere unrelated.
 */
export class FakeClock {
  private current: Date;

  constructor(start: Date) {
    this.current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  /** Move forward. Negative values are rejected — a clock that runs backwards
   *  hides ordering bugs rather than exposing them. */
  advance(milliseconds: number): this {
    if (milliseconds < 0) {
      throw new Error('FakeClock cannot move backwards; construct a new clock instead');
    }
    this.current = new Date(this.current.getTime() + milliseconds);
    return this;
  }

  advanceMinutes(minutes: number): this {
    return this.advance(minutes * 60_000);
  }

  advanceDays(days: number): this {
    return this.advance(days * 86_400_000);
  }
}
