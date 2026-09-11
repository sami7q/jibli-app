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
 * Minimum policy for portal passwords. Length is the dominant factor, so this
 * favours a long passphrase over mandatory symbol classes.
 */
export interface PasswordPolicyResult {
  readonly ok: boolean;
  readonly problems: string[];
}

export function checkPasswordPolicy(plaintext: string): PasswordPolicyResult {
  const problems: string[] = [];
  if (plaintext.length < 12) problems.push('PASSWORD_TOO_SHORT');
  if (plaintext.length > 256) problems.push('PASSWORD_TOO_LONG');
  if (!/[a-z]/i.test(plaintext) && !/[؀-ۿ]/.test(plaintext)) {
    problems.push('PASSWORD_NEEDS_LETTERS');
  }
  if (!/\d/.test(plaintext)) problems.push('PASSWORD_NEEDS_DIGIT');
  if (/^(.)\1+$/.test(plaintext)) problems.push('PASSWORD_TOO_REPETITIVE');
  return { ok: problems.length === 0, problems };
}
