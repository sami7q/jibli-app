/**
 * Arabic for the shop's operational state (MERCH-7, MERCH-8).
 *
 * `GET /settings` returns a `closed_reason` enum — OPEN / PAUSED / OUTSIDE_HOURS
 * / CLOSED_TODAY / NO_SCHEDULE, plus NOT_ACCEPTING_ORDERS when the branch toggle
 * is off. Settings used to interpolate the raw code («المطعم لا يستقبل الطلبات
 * حالياً: PAUSED») and the dashboard showed nothing at all. Both now read from
 * one table.
 */
export const CLOSED_REASON_LABELS_AR: Record<string, string> = {
  OPEN: 'يستقبل الطلبات الآن',
  PAUSED: 'متوقف مؤقتاً عن استقبال الطلبات',
  NOT_ACCEPTING_ORDERS: 'استقبال الطلبات موقوف من الإعدادات',
  OUTSIDE_HOURS: 'خارج ساعات العمل الآن',
  CLOSED_TODAY: 'مغلق اليوم',
  NO_SCHEDULE: 'لم تُحدَّد ساعات عمل بعد',
  NO_BRANCH: 'لا يوجد فرع فعّال',
};

/** The Arabic label for a `closed_reason` code, falling back to the code itself. */
export function closedReasonAr(code: string): string {
  return CLOSED_REASON_LABELS_AR[code] ?? code;
}
