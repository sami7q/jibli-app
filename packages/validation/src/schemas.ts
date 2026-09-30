import { z } from 'zod';
import { containsArabic, normalizeDigits, sanitizeDisplayText } from './arabic.js';
import { checkFullName } from './names.js';
import { toE164Iraq } from './phone.js';

/**
 * Shared Zod primitives.
 *
 * Plan §75: validation happens at several levels and shared schemas must not leak
 * server-only details. Everything here is safe for clients to import.
 */

/** UUIDv7 is used for internal IDs (plan §25); v4 is accepted for seeded rows. */
export const uuidSchema = z.string().uuid();

/**
 * Iraqi phone input. Accepts every human form and always yields E.164, so the
 * rest of the system only ever sees +9647XXXXXXXX.
 */
export const iraqiPhoneSchema = z
  .string()
  .min(1, 'رقم الهاتف مطلوب')
  .max(24)
  .transform((value, ctx) => {
    try {
      return toE164Iraq(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'رقم هاتف عراقي غير صالح' });
      return z.NEVER;
    }
  });

/**
 * The name a customer is greeted and addressed by.
 *
 * Plan §11: "valid Unicode text with reasonable length and control-character
 * restrictions". Digits and symbols stay rejected — a name field is a frequent
 * target for injected junk, and nothing legitimate needs them.
 *
 * What was dropped is the requirement for two words. It was asking for a
 * document, not a name: plenty of people go by one, an Iraqi customer may give
 * a first name and a tribal name that reads as one token, and the app only
 * ever needs something to put on an order and say مرحباً to. A delivery is
 * identified by a phone number and a PIN, never by matching a name against
 * anything — so the rule rejected real people and protected nothing.
 */
export const fullNameSchema = z.string().transform((value, ctx) => {
  // The rule itself lives in names.ts, where the phone can read it without zod.
  const result = checkFullName(value);
  if (!result.ok) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.message });
    return z.NEVER;
  }
  return result.value;
});

/** Free-form display text such as a restaurant or menu item name. */
export const displayNameSchema = (min = 2, max = 120) =>
  z.string().transform(sanitizeDisplayText).pipe(z.string().min(min).max(max));

/** Optional multi-line text such as a description or a delivery note. */
export const notesSchema = (max = 500) =>
  z
    .string()
    .max(max)
    .transform((v) => sanitizeDisplayText(v))
    .optional();

/** An Arabic-language field that must genuinely contain Arabic (plan §2). */
export const arabicTextSchema = (min = 2, max = 120) =>
  z
    .string()
    .transform(sanitizeDisplayText)
    .pipe(z.string().min(min).max(max))
    .refine(containsArabic, { message: 'الحقل يجب أن يكون بالعربية' });

/**
 * OTP code. Arabic-Indic digits are folded first so a customer using an Arabic
 * keypad is not told their correct code is wrong.
 */
export const otpCodeSchema = z
  .string()
  .transform((v) => normalizeDigits(v).trim())
  .pipe(z.string().regex(/^\d{4,8}$/, 'رمز التحقق غير صالح'));

/** Delivery PIN entered by the driver (plan §52). */
export const deliveryPinSchema = z
  .string()
  .transform((v) => normalizeDigits(v).trim())
  .pipe(z.string().regex(/^\d{4,6}$/, 'رمز التسليم غير صالح'));

/** Integer IQD amount arriving over the wire. Never a float. */
export const iqdAmountSchema = z
  .number()
  .int('المبلغ يجب أن يكون رقماً صحيحاً')
  .min(0)
  .max(9_999_999_999);

export const bpsSchema = z.number().int().min(0).max(10_000);

/** Positive order-line quantity; capped to keep a typo from becoming a 10,000-item order. */
export const quantitySchema = z.number().int().min(1).max(99);

/** WGS84 coordinates, with Iraq's bounding box as a sanity check. */
export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

const IRAQ_BOUNDS = { minLat: 28.5, maxLat: 37.5, minLng: 38.7, maxLng: 48.9 } as const;

export const iraqCoordinatesSchema = z
  .object({ latitude: latitudeSchema, longitude: longitudeSchema })
  .refine(
    (c) =>
      c.latitude >= IRAQ_BOUNDS.minLat &&
      c.latitude <= IRAQ_BOUNDS.maxLat &&
      c.longitude >= IRAQ_BOUNDS.minLng &&
      c.longitude <= IRAQ_BOUNDS.maxLng,
    { message: 'الإحداثيات خارج حدود العراق' },
  );

export function isWithinIraq(latitude: number, longitude: number): boolean {
  return (
    latitude >= IRAQ_BOUNDS.minLat &&
    latitude <= IRAQ_BOUNDS.maxLat &&
    longitude >= IRAQ_BOUNDS.minLng &&
    longitude <= IRAQ_BOUNDS.maxLng
  );
}

/**
 * Idempotency key supplied by clients on money-moving commands (plan §28).
 * Constrained so it can safely become part of a unique index.
 */
export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_:.-]+$/, 'Idempotency key contains unsupported characters');

/** Optimistic-concurrency token echoed back on state transitions (plan §32). */
export const versionSchema = z.number().int().min(0);

/** Cursor pagination. Page size is capped server-side (plan §74). */
export const paginationSchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Offset pagination for bounded admin tables. */
export const offsetPaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/**
 * Sort input. Callers pass their own allowlist — arbitrary client column names
 * must never reach SQL (plan §74, §81).
 */
export function sortSchema<T extends readonly [string, ...string[]]>(allowedFields: T) {
  return z.object({
    sortBy: z.enum(allowedFields).optional(),
    sortDir: z.enum(['asc', 'desc']).default('desc'),
  });
}

/** Bounded, normalized search term. */
export const searchQuerySchema = z
  .string()
  .max(80)
  .transform((v) => sanitizeDisplayText(v));

/** ISO date string constrained to a calendar date (no time component). */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'صيغة التاريخ غير صحيحة');

/** A reason string required on destructive or high-impact admin actions (plan §114). */
export const reasonSchema = z
  .string()
  .transform(sanitizeDisplayText)
  .pipe(z.string().min(5, 'الرجاء كتابة سبب واضح').max(500));
