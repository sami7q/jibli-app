import { formatIqdArabic, formatIqdDigits, iqd } from '@jibli/money';

/**
 * Arabic display formatting shared by both portals.
 *
 * Plan §2 keeps UI strings out of business logic so a second language is a data
 * change. These helpers are the display layer for values the server already
 * computed — they never do arithmetic.
 */

/** "31,000 د.ع" — the form used throughout the reference designs. */
export function money(amount: number): string {
  return formatIqdArabic(iqd(amount));
}

/** Grouped digits with no currency suffix, for a column with a unit header. */
export function moneyDigits(amount: number): string {
  return formatIqdDigits(iqd(amount));
}

/** "٣٤٢ ألف" style compaction for dashboard tiles with limited width. */
export function moneyCompact(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(1).replace(/\.0$/, '')} مليون د.ع`;
  }
  if (Math.abs(amount) >= 1_000) {
    return `${(amount / 1_000).toFixed(0)} ألف د.ع`;
  }
  return money(amount);
}

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

const ARABIC_WEEKDAYS = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
] as const;

const BAGHDAD = 'Asia/Baghdad';

/** Wall-clock parts in Baghdad — portals always display business time. */
function baghdadParts(value: Date | string) {
  const date = typeof value === 'string' ? new Date(value) : value;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: BAGHDAD,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(get('hour'));
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: hour === 24 ? 0 : hour,
    minute: Number(get('minute')),
    date,
  };
}

/** "14:32" in Baghdad time. */
export function time(value: Date | string): string {
  const p = baghdadParts(value);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** "10 آب 2025". */
export function dateAr(value: Date | string): string {
  const p = baghdadParts(value);
  return `${p.day} ${ARABIC_MONTHS[p.month - 1]} ${p.year}`;
}

/** "السبت، 10 آب 2025". */
export function dateWithWeekdayAr(value: Date | string): string {
  const p = baghdadParts(value);
  const weekday = ARABIC_WEEKDAYS[p.date.getUTCDay()] ?? '';
  return `${weekday}، ${dateAr(value)}`;
}

export function dateTimeAr(value: Date | string): string {
  return `${dateAr(value)} · ${time(value)}`;
}

/**
 * "منذ 12 دقيقة" — the age label on a live order card (plan §29).
 * Arabic dual and plural forms matter: "دقيقتين" is not "2 دقيقة".
 */
export function relativeAr(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'الآن';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `منذ ${pluralAr(minutes, 'دقيقة', 'دقيقتين', 'دقائق')}`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${pluralAr(hours, 'ساعة', 'ساعتين', 'ساعات')}`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `منذ ${pluralAr(days, 'يوم', 'يومين', 'أيام')}`;

  return dateAr(date);
}

/**
 * Arabic pluralisation.
 *
 * Arabic has singular, dual and plural, and the plural form itself changes
 * above ten. Getting this wrong is immediately obvious to a native reader.
 */
export function pluralAr(count: number, singular: string, dual: string, plural: string): string {
  if (count === 1) return singular;
  if (count === 2) return dual;
  if (count >= 3 && count <= 10) return `${count} ${plural}`;
  return `${count} ${singular}`;
}

/** "12 طلب" / "طلبان" / "5 طلبات". */
export function ordersCountAr(count: number): string {
  return pluralAr(count, 'طلب واحد', 'طلبان', 'طلبات');
}

/** Percentage for a delta chip, always with an explicit sign. */
export function percentDelta(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded}%`;
}

/**
 * Basis points as a readable rate: 2000 -> "20%".
 *
 * Defined in @jibli/money and re-exported here so a web caller still gets it
 * from one formatting import, while the API can reach it without depending on
 * a React package.
 */
export { bpsPercent } from '@jibli/money';
