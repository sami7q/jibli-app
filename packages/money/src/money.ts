/**
 * Money — integer IQD arithmetic.
 *
 * Plan §100: all IQD monetary values are integer minor values, JavaScript
 * floating point is never used for financial calculations, commission uses basis
 * points, and one deterministic rounding policy is shared by orders, settlements,
 * reports and exports.
 *
 * IQD is treated as a zero-decimal currency in Release 1: 31,000 IQD is the
 * integer 31000. There is no sub-unit to lose, so the only rounding that ever
 * happens is when a basis-point rate is applied to a base amount.
 */

/** Branded integer IQD amount. */
export type Iqd = number & { readonly __brand: 'IQD' };

/** Basis points. 100 bps = 1%. 10000 bps = 100%. */
export type Bps = number & { readonly __brand: 'BPS' };

export const BPS_DENOMINATOR = 10_000;

/** Guard rail: anything above this is a data-entry error, not a real order. */
export const MAX_IQD = 9_999_999_999;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

export function isIqd(value: unknown): value is Iqd {
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= MAX_IQD;
}

/**
 * Construct a validated IQD amount. Rejects floats outright — a fractional IQD
 * reaching this function means a caller did untyped arithmetic somewhere upstream.
 */
export function iqd(value: number): Iqd {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MoneyError(`IQD amount must be a finite number, received: ${String(value)}`);
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError(`IQD amount must be an integer, received: ${value}`);
  }
  if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_IQD) {
    throw new MoneyError(`IQD amount out of supported range: ${value}`);
  }
  return value as Iqd;
}

/** Zero, typed. */
export const ZERO_IQD = 0 as Iqd;

/** Parse an amount that arrived as a string (DB numeric, CSV import, API payload). */
export function parseIqd(value: string | number): Iqd {
  if (typeof value === 'number') return iqd(value);
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new MoneyError(`Cannot parse IQD amount from "${value}"`);
  }
  return iqd(Number(trimmed));
}

export function bps(value: number): Bps {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`Basis points must be an integer, received: ${value}`);
  }
  if (value < 0 || value > BPS_DENOMINATOR) {
    throw new MoneyError(`Basis points must be within 0..${BPS_DENOMINATOR}, received: ${value}`);
  }
  return value as Bps;
}

export function addIqd(...amounts: Iqd[]): Iqd {
  return iqd(amounts.reduce<number>((sum, a) => sum + a, 0));
}

export function subtractIqd(minuend: Iqd, ...subtrahends: Iqd[]): Iqd {
  return iqd(subtrahends.reduce<number>((acc, a) => acc - a, minuend));
}

export function multiplyIqd(amount: Iqd, quantity: number): Iqd {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new MoneyError(`Quantity must be a non-negative integer, received: ${quantity}`);
  }
  return iqd(amount * quantity);
}

/** Never let a derived amount go below zero (e.g. a discount larger than the base). */
export function clampNonNegative(amount: Iqd): Iqd {
  return amount < 0 ? ZERO_IQD : amount;
}

export function minIqd(a: Iqd, b: Iqd): Iqd {
  return a <= b ? a : b;
}

export function maxIqd(a: Iqd, b: Iqd): Iqd {
  return a >= b ? a : b;
}

/**
 * The platform's single rounding policy: half-up on the absolute value, so the
 * sign never changes which way a boundary rounds. Applied only where a rate meets
 * an amount — commission and percentage discounts.
 *
 * Half-up (rather than banker's rounding) is chosen because it is what a
 * restaurant owner reproduces on a calculator when checking a statement.
 */
export function roundHalfUp(numerator: number, denominator: number): number {
  if (denominator === 0) throw new MoneyError('Division by zero in rounding policy');
  const sign = Math.sign(numerator) * Math.sign(denominator) || 1;
  const absNumerator = Math.abs(numerator);
  const absDenominator = Math.abs(denominator);
  const quotient = Math.floor(absNumerator / absDenominator);
  const remainderTwice = (absNumerator % absDenominator) * 2;
  const rounded = remainderTwice >= absDenominator ? quotient + 1 : quotient;
  return sign * rounded;
}

/**
 * Apply a basis-point rate to an amount using the platform rounding policy.
 * This is THE commission primitive — plan §24 and §224.
 */
export function applyBps(amount: Iqd, rate: Bps): Iqd {
  if (!Number.isSafeInteger(amount * rate)) {
    // Guard against precision loss before it silently corrupts a statement.
    throw new MoneyError(`Commission intermediate exceeds safe integer range: ${amount} × ${rate}`);
  }
  return iqd(roundHalfUp(amount * rate, BPS_DENOMINATOR));
}

/** Percentage helper for display only — never feed this back into arithmetic. */
export function bpsToPercentString(rate: Bps): string {
  const whole = Math.floor(rate / 100);
  const fraction = rate % 100;
  if (fraction === 0) return `${whole}%`;
  return `${whole}.${String(fraction).padStart(2, '0').replace(/0$/, '')}%`;
}

export function percentToBps(percent: number): Bps {
  const raw = roundHalfUp(percent * 100, 1);
  return bps(raw);
}

/**
 * Split an amount into N parts without losing or inventing a single dinar.
 * Remainder dinars are distributed to the earliest parts, so the sum of the
 * result always equals the input exactly.
 */
export function allocate(amount: Iqd, weights: number[]): Iqd[] {
  if (weights.length === 0) throw new MoneyError('Cannot allocate across zero parts');
  if (weights.some((w) => w < 0)) throw new MoneyError('Allocation weights must be non-negative');
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight === 0) throw new MoneyError('Allocation weights must not sum to zero');

  const parts = weights.map((w) => Math.floor((amount * w) / totalWeight));
  let remainder = amount - parts.reduce((sum, p) => sum + p, 0);
  for (let i = 0; remainder > 0; i = (i + 1) % parts.length) {
    parts[i] = (parts[i] ?? 0) + 1;
    remainder -= 1;
  }
  return parts.map((p) => iqd(p));
}

const ARABIC_IQD_SUFFIX = 'د.ع';

/**
 * Arabic display formatting. Uses Western digits with thousands separators —
 * matching the reference designs, which render "31,000 د.ع".
 */
export function formatIqdArabic(amount: Iqd): string {
  const formatted = new Intl.NumberFormat('en-US').format(amount);
  return `${formatted} ${ARABIC_IQD_SUFFIX}`;
}

/** Plain grouped digits, no currency suffix — for table cells that carry a unit header. */
export function formatIqdDigits(amount: Iqd): string {
  return new Intl.NumberFormat('en-US').format(amount);
}
