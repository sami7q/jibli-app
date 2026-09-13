import { formatIqdArabic, iqd } from './money.js';

/**
 * Formatting for commission and rate figures.
 *
 * Lives beside the money helpers rather than in the web UI package because the
 * API renders the same string onto settlement statements. A server reaching
 * into a React package for a pure function drags JSX into its compile graph and
 * couples the backend to a frontend release.
 */

/** Basis points as a readable rate: 2000 -> "20%", 1250 -> "12.5%". */
export function bpsPercent(rateBps: number): string {
  const whole = rateBps / 100;
  return `${Number.isInteger(whole) ? whole : whole.toFixed(2).replace(/0$/, '')}%`;
}

/**
 * A commission as a readable fee: 500 -> "500 د.ع لكل طلب".
 *
 * "Per order" is part of the string rather than a caption beside it, because
 * the number alone is ambiguous in every place it appears — a restaurant
 * reading "500 د.ع" on a statement line has no way to tell a per-order fee from
 * a total, and that ambiguity is exactly what a flat fee invites.
 */
export function commissionFeeDisplay(amountIqd: number): string {
  return `${formatIqdArabic(iqd(amountIqd))} لكل طلب`;
}
