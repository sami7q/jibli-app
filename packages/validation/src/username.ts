import { z } from 'zod';

/**
 * Portal usernames.
 *
 * The threat this shape defends against is impersonation by confusable name.
 * A username that may contain Unicode lets an attacker register a name that
 * *renders* identically to a real one — Cyrillic а for Latin a, a zero-width
 * joiner, or a right-to-left override that reverses how the rest of the string
 * displays. Next to an audit entry reading "approved by <name>", that is the
 * whole attack.
 *
 * So: lowercase ASCII letters, digits, and three separators. Nothing else can
 * be represented, which is stronger than trying to detect the lookalikes.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;

/** Must start alphanumeric so a name cannot lead with a separator. */
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/**
 * Names nobody may take.
 *
 * Two groups, for two different reasons. Administrative words because a
 * support conversation about "admin" must be unambiguous, and route-like words
 * because a username appearing in a URL path should never collide with a real
 * route.
 */
const RESERVED = new Set([
  'admin', 'administrator', 'root', 'superuser', 'sysadmin', 'system',
  'jibli', 'support', 'help', 'security', 'billing', 'finance', 'noreply',
  'api', 'app', 'www', 'mail', 'ftp', 'login', 'logout', 'signup', 'register',
  'settings', 'account', 'accounts', 'user', 'users', 'me', 'null', 'undefined',
]);

export function isReservedUsername(value: string): boolean {
  return RESERVED.has(value.trim().toLowerCase());
}

/**
 * Normalise before comparing or storing.
 *
 * The database indexes lower(username), so anything that writes a username
 * without lowering it first would create a row the unique index rejects for
 * confusing reasons. Doing it here means there is one place that decides.
 */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export const usernameSchema = z
  .string()
  .trim()
  .transform(normalizeUsername)
  .refine((value) => value.length >= USERNAME_MIN && value.length <= USERNAME_MAX, {
    message: `اسم المستخدم يجب أن يكون بين ${USERNAME_MIN} و ${USERNAME_MAX} حرفاً`,
  })
  .refine((value) => USERNAME_PATTERN.test(value), {
    message: 'اسم المستخدم: أحرف إنجليزية صغيرة وأرقام و . _ - فقط، ويبدأ بحرف أو رقم',
  })
  .refine((value) => !isReservedUsername(value), {
    message: 'اسم المستخدم محجوز، اختر اسماً آخر',
  });

/**
 * A username as typed at sign-in.
 *
 * Deliberately looser than `usernameSchema`: the login endpoint must not
 * reject a malformed username with a *different* error than a wrong password,
 * or the difference becomes a way to test which names exist. It only lowercases
 * and bounds the length so an oversized body cannot reach the database.
 */
export const loginIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform(normalizeUsername);

/**
 * Suggest a username from a restaurant's name.
 *
 * Arabic display names cannot become ASCII usernames by transliteration
 * without guessing, so this uses whatever ASCII the name already contains and
 * otherwise falls back to a prefix the caller supplies (the partner code).
 * A suggestion, never applied without the operator seeing it.
 */
export function suggestUsername(displayName: string, fallback: string): string {
  const ascii = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, USERNAME_MAX);

  if (ascii.length >= USERNAME_MIN && !isReservedUsername(ascii)) return ascii;

  const cleaned = fallback.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return `r-${cleaned}`.slice(0, USERNAME_MAX);
}
