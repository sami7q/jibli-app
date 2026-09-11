import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing for portal users (plan §77).
 *
 * Customers and drivers authenticate by OTP and have no password. Restaurant and
 * Admin web users do, and those hashes must survive a database compromise.
 *
 * Argon2id is the memory-hard choice: it resists both GPU and side-channel
 * attacks, unlike bcrypt's fixed 4KB working set.
 */

const ARGON2_OPTIONS = {
  // Algorithm.Argon2id — the numeric literal avoids importing an ambient const enum.
  algorithm: 2,
  /** 19 MiB — the OWASP baseline for Argon2id. */
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON2_OPTIONS);
}

/**
 * Verify a password. Returns false rather than throwing on a malformed hash, so
 * a corrupted row cannot turn into a 500 that distinguishes it from a wrong
 * password.
 */
export async function verifyPassword(plaintext: string, digest: string): Promise<boolean> {
  try {
    return await verify(digest, plaintext, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * Password policy for portal accounts.
 *
 * Follows NIST SP 800-63B, which is worth stating because it rules things
 * *out* as much as in:
 *
 *   - Length dominates. A long passphrase beats a short string with a symbol
 *     bolted on, so there is no "must contain punctuation" rule here.
 *   - **No forced expiry.** Periodic rotation is not implemented anywhere in
 *     this system on purpose: it pushes people to `Summer2026!` then
 *     `Autumn2026!`, which is weaker than the password it replaced. Rotation
 *     happens on suspicion of compromise, which is what `mustChangePassword`
 *     is for.
 *   - Reject the passwords attackers actually try first. A composition rule
 *     does not stop `Password123!`; a list does.
 */
export interface PasswordPolicyResult {
  readonly ok: boolean;
  readonly problems: string[];
}

/** Admin accounts reach further into money and roles, so they are held higher. */
export const PASSWORD_MIN_LENGTH = 12;
export const ADMIN_PASSWORD_MIN_LENGTH = 14;
const PASSWORD_MAX_LENGTH = 256;

/**
 * The shapes that survive a length rule but not a real attacker.
 *
 * Not a breach corpus — that belongs behind an API or a bundled dataset, and
 * is a separate piece of work. This is the short list of patterns that show up
 * in a first pass of credential stuffing, plus the ones specific to this
 * product, which a generic list would miss.
 */
const COMMON_PATTERNS: readonly RegExp[] = [
  /^password/i,
  /^welcome/i,
  /^admin/i,
  /^letmein/i,
  /^qwert/i,
  /^jibli/i,
  /^123456/,
  /^abc123/i,
  /^iloveyou/i,
];

/**
 * Too few distinct characters to be worth its length.
 *
 * `aaaaaaaaaaaaa1` is fourteen characters and satisfies every other rule, but
 * a search over "one repeated character plus a digit" finds it immediately.
 * Counting distinct characters catches that whole family without banning any
 * particular shape.
 */
function hasTooFewDistinctCharacters(value: string): boolean {
  return new Set(value).size < 5;
}

/** Single repeated character, or a plain ascending/descending run. */
function isTrivialSequence(value: string): boolean {
  // Backreference: the whole string is one character repeated.
  if (/^(.)\1+$/.test(value)) return true;

  const lower = value.toLowerCase();
  let ascending = true;
  let descending = true;
  for (let i = 1; i < lower.length; i += 1) {
    const delta = lower.charCodeAt(i) - lower.charCodeAt(i - 1);
    if (delta !== 1) ascending = false;
    if (delta !== -1) descending = false;
  }
  return ascending || descending;
}

export function checkPasswordPolicy(
  plaintext: string,
  options: { minLength?: number; username?: string } = {},
): PasswordPolicyResult {
  const minLength = options.minLength ?? PASSWORD_MIN_LENGTH;
  const problems: string[] = [];

  if (plaintext.length < minLength) problems.push('PASSWORD_TOO_SHORT');
  if (plaintext.length > PASSWORD_MAX_LENGTH) problems.push('PASSWORD_TOO_LONG');

  // Arabic counts as letters: a passphrase does not have to be English.
  if (!/[a-z]/i.test(plaintext) && !/[؀-ۿ]/.test(plaintext)) {
    problems.push('PASSWORD_NEEDS_LETTERS');
  }
  if (!/\d/.test(plaintext)) problems.push('PASSWORD_NEEDS_DIGIT');

  if (isTrivialSequence(plaintext) || hasTooFewDistinctCharacters(plaintext)) {
    problems.push('PASSWORD_TOO_REPETITIVE');
  }
  if (COMMON_PATTERNS.some((pattern) => pattern.test(plaintext))) {
    problems.push('PASSWORD_TOO_COMMON');
  }

  /*
   * A password containing the username is the first thing tried once the
   * username is known — and for restaurant accounts the username is derived
   * from a name printed on the shopfront.
   */
  const username = options.username?.trim().toLowerCase();
  if (username && username.length >= 3 && plaintext.toLowerCase().includes(username)) {
    problems.push('PASSWORD_CONTAINS_USERNAME');
  }

  return { ok: problems.length === 0, problems };
}

/** Arabic for each policy failure, so a form can list them (plan §113). */
export const PASSWORD_PROBLEM_MESSAGES_AR: Record<string, string> = {
  PASSWORD_TOO_SHORT: 'كلمة المرور قصيرة جداً',
  PASSWORD_TOO_LONG: 'كلمة المرور طويلة جداً',
  PASSWORD_NEEDS_LETTERS: 'يجب أن تحتوي على أحرف',
  PASSWORD_NEEDS_DIGIT: 'يجب أن تحتوي على رقم واحد على الأقل',
  PASSWORD_TOO_REPETITIVE: 'كلمة المرور متكررة أو متسلسلة بشكل واضح',
  PASSWORD_TOO_COMMON: 'كلمة المرور شائعة ومعروفة للمهاجمين',
  PASSWORD_CONTAINS_USERNAME: 'كلمة المرور يجب ألا تحتوي على اسم المستخدم',
};
