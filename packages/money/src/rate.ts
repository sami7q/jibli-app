/**
 * Formatting for basis-point rates.
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
