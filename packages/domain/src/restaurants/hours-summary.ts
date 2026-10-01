import { formatMinuteOfDay, WEEKDAY_NAMES_AR, type WorkingHourRule } from './working-hours.js';

/**
 * A week of hours in one Arabic line, for a screen that reads rather than edits.
 *
 * Admin's restaurant page used to say nothing about hours at all, so a shop
 * that was "closed" because it had no schedule looked exactly like one that
 * was closed because the owner chose Friday off. Seven rows is too much for
 * that page; one sentence is what an operator needs to answer "why is it
 * closed?" — and most weeks are one window with a day or two off.
 */
export function describeWeekAr(rules: readonly WorkingHourRule[]): string {
  if (rules.length === 0) return 'لم تُضبط';
  const open = rules.filter((rule) => !rule.isClosed);
  if (open.length === 0) return 'مغلق كل الأيام';

  const [first] = open;
  const uniform = open.every(
    (rule) =>
      rule.opensAtMinute === first!.opensAtMinute && rule.closesAtMinute === first!.closesAtMinute,
  );
  if (!uniform) return 'تختلف حسب اليوم';

  const window = describeWindowAr(first!.opensAtMinute, first!.closesAtMinute);

  // A day with no rule is a day the shop never opens, the same as a closed row.
  const openDays = new Set(open.map((rule) => rule.dayOfWeek));
  const closedNames = WEEKDAY_NAMES_AR.filter((_, day) => !openDays.has(day));
  if (closedNames.length === 0) return `يومياً ${window}`;
  return `${window}، مغلق ${closedNames.join(' و')}`;
}

/** "08:00–23:00", or "18:00–02:00 (بعد منتصف الليل)" when the night runs over. */
export function describeWindowAr(opensAtMinute: number, closesAtMinute: number): string {
  if (opensAtMinute === 0 && (closesAtMinute === 0 || closesAtMinute === 1440)) return '24 ساعة';
  const range = `${formatMinuteOfDay(opensAtMinute)}–${formatMinuteOfDay(closesAtMinute)}`;
  // 1440 is midnight of the same day, not a shift into the next one.
  const overnight = closesAtMinute < opensAtMinute;
  return overnight ? `${range} (بعد منتصف الليل)` : range;
}
