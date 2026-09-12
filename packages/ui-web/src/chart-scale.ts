/**
 * Where a chart's value axis puts its ticks.
 *
 * Split out of `charts.tsx` so it can be tested without a DOM, because the bug
 * it exists to prevent took the whole admin dashboard down in production:
 *
 *   MoneyError: IQD amount must be an integer, received: 0.25
 *
 * The axis named five evenly-spaced values by multiplying the scale ceiling by
 * 0, 0.25, 0.5, 0.75 and 1. On an empty database the ceiling is 1, so the
 * second tick was 0.25 — and the dinar is an integer currency, so formatting it
 * threw. Every panel on the page was unmounted by one label on one chart.
 *
 * It never showed in testing with sample data, because any realistic ceiling is
 * a multiple of four. Only a near-empty platform reaches the broken case, which
 * is exactly the state a new deployment is in.
 */

/** Evenly spaced, bottom to top. Zero included so the baseline is named. */
export const AXIS_FRACTIONS = [0, 0.25, 0.5, 0.75, 1] as const;

export interface AxisTick {
  /** Height up the plot, 0 at the baseline and 1 at the ceiling. */
  readonly fraction: number;
  /** The value that height represents. Always an integer. */
  readonly value: number;
}

/**
 * Round the scale to a readable ceiling: 1, 2, 5 or 10 times a power of ten.
 * A ceiling of zero would make every point sit on the baseline and divide by
 * nothing, so an empty series gets 1.
 */
export function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalized = max / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Ticks for a scale, every value an integer.
 *
 * When the ceiling is too small to give each tick its own integer — five ticks
 * need a ceiling of at least four — the axis names only the baseline and the
 * ceiling rather than repeating "0, 0, 1, 1, 1".
 */
export function axisTicks(max: number): AxisTick[] {
  const ceiling = Math.round(max);
  const full = AXIS_FRACTIONS.map((fraction) => ({
    fraction,
    value: Math.round(max * fraction),
  }));

  const distinct = new Set(full.map((tick) => tick.value));
  if (distinct.size === full.length) return full;

  return [
    { fraction: 0, value: 0 },
    { fraction: 1, value: ceiling },
  ];
}
