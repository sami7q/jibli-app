/**
 * Business calendar.
 *
 * Plan §4.8: "Timestamps are stored in UTC. Business reports and settlement
 * periods use Asia/Baghdad. Working-hour logic is timezone-aware."
 *
 * Offsets are resolved through the Intl API rather than hard-coded. Iraq has not
 * observed DST since 2008, but encoding "+3 always" would silently produce wrong
 * settlement boundaries if that ever changed — and the same helpers are reused
 * for any future market.
 */

export const BAGHDAD_TZ = 'Asia/Baghdad';

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock fields of an instant, as seen in the given zone. */
export function toZonedParts(instant: Date, timeZone: string = BAGHDAD_TZ): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((p) => p.type === type)?.value ?? '0';
    return Number.parseInt(value, 10);
  };
  // Intl renders midnight as hour 24 in some engines; normalise to 0.
  const hour = get('hour');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: hour === 24 ? 0 : hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/** The zone's UTC offset, in milliseconds, at a given instant. */
export function zoneOffsetMs(instant: Date, timeZone: string = BAGHDAD_TZ): number {
  const parts = toZonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // Second-resolution comparison; drop sub-second noise from the instant.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Convert a wall-clock time in a zone to the UTC instant it denotes.
 *
 * The offset is applied twice: the first guess uses the offset at the naive
 * instant, the second corrects it if that guess landed on the other side of a
 * transition. Two passes converge for every real-world zone rule.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  timeZone: string = BAGHDAD_TZ,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = zoneOffsetMs(new Date(naive), timeZone);
  const firstGuess = naive - firstOffset;
  const secondOffset = zoneOffsetMs(new Date(firstGuess), timeZone);
  return new Date(secondOffset === firstOffset ? firstGuess : naive - secondOffset);
}

/** Business date (YYYY-MM-DD) an instant falls on, in Baghdad. */
export function businessDate(instant: Date, timeZone: string = BAGHDAD_TZ): string {
  const { year, month, day } = toZonedParts(instant, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Minutes since local midnight — the unit working hours are stored in. */
export function minutesSinceLocalMidnight(instant: Date, timeZone: string = BAGHDAD_TZ): number {
  const { hour, minute } = toZonedParts(instant, timeZone);
  return hour * 60 + minute;
}

/** 0 = Sunday … 6 = Saturday, in the business zone. */
export function localDayOfWeek(instant: Date, timeZone: string = BAGHDAD_TZ): number {
  const { year, month, day } = toZonedParts(instant, timeZone);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Start of a local calendar day, as a UTC instant. */
export function startOfBusinessDay(instant: Date, timeZone: string = BAGHDAD_TZ): Date {
  const { year, month, day } = toZonedParts(instant, timeZone);
  return zonedTimeToUtc(year, month, day, 0, 0, 0, timeZone);
}

export function addDays(instant: Date, days: number): Date {
  return new Date(instant.getTime() + days * 24 * 60 * 60 * 1000);
}

export function addMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60 * 1000);
}

/** Format an instant for Arabic UI display, in Baghdad time. */
export function formatBaghdadTime(instant: Date, timeZone: string = BAGHDAD_TZ): string {
  const { hour, minute } = toZonedParts(instant, timeZone);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function formatBaghdadDateTime(instant: Date, timeZone: string = BAGHDAD_TZ): string {
  return `${businessDate(instant, timeZone)} ${formatBaghdadTime(instant, timeZone)}`;
}
