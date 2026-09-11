import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP multi-factor authentication (plan §88).
 *
 * "MFA is mandatory for Super Admin and Finance Admin before production
 * launch." Critical operations additionally require a *fresh* challenge, which
 * `hasFreshMfa` in principal.ts enforces.
 *
 * RFC 6238 TOTP over HMAC-SHA1 — the algorithm every authenticator app
 * implements. SHA-1 here is not a security weakness: TOTP's security comes from
 * the shared secret and the 30-second window, and HMAC-SHA1 has no practical
 * attack. Choosing SHA-256 would silently break Google Authenticator.
 */

/** Seconds per code. 30 is the universal default; changing it breaks apps. */
const TIME_STEP_SECONDS = 30;

/** Digits in a generated code. */
const CODE_DIGITS = 6;

/**
 * How many steps either side of "now" are accepted.
 *
 * One step (±30s) absorbs ordinary clock drift between a phone and the server
 * without meaningfully widening the guess window.
 */
const ACCEPTED_DRIFT_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encode bytes as unpadded base32 — the format authenticator apps expect. */
export function toBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function fromBase32(encoded: string): Buffer {
  const normalized = encoded.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character in TOTP secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generate a TOTP secret.
 *
 * 20 bytes (160 bits) is the RFC 4226 recommendation and matches the HMAC-SHA1
 * block size, so no key stretching or truncation occurs.
 */
export function generateTotpSecret(): string {
  return toBase32(randomBytes(20));
}

/** Compute the TOTP code for a given counter step. */
function computeCode(secret: Buffer, counter: number): string {
  // 8-byte big-endian counter.
  const buffer = Buffer.alloc(8);
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buffer.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac('sha1', secret).update(buffer).digest();

  // Dynamic truncation (RFC 4226 §5.3).
  const offset = (digest[digest.length - 1] as number) & 0x0f;
  const binary =
    (((digest[offset] as number) & 0x7f) << 24) |
    (((digest[offset + 1] as number) & 0xff) << 16) |
    (((digest[offset + 2] as number) & 0xff) << 8) |
    ((digest[offset + 3] as number) & 0xff);

  return String(binary % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, '0');
}

export function generateTotpCode(secretBase32: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / TIME_STEP_SECONDS);
  return computeCode(fromBase32(secretBase32), counter);
}

/**
 * Verify a submitted TOTP code.
 *
 * Returns the counter step that matched, so the caller can persist it and
 * refuse a replay of the same code within its window — without that, an
 * observed code stays usable for the rest of its 30 seconds.
 */
export function verifyTotpCode(
  secretBase32: string,
  submitted: string,
  options: { atMs?: number; lastUsedCounter?: number | null } = {},
): { valid: boolean; counter: number | null } {
  const code = submitted.replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return { valid: false, counter: null };

  const secret = fromBase32(secretBase32);
  const currentCounter = Math.floor((options.atMs ?? Date.now()) / 1000 / TIME_STEP_SECONDS);

  for (let drift = -ACCEPTED_DRIFT_STEPS; drift <= ACCEPTED_DRIFT_STEPS; drift += 1) {
    const counter = currentCounter + drift;

    // Reject a code already consumed: a shoulder-surfed code must not work twice.
    if (options.lastUsedCounter !== null && options.lastUsedCounter !== undefined) {
      if (counter <= options.lastUsedCounter) continue;
    }

    const expected = computeCode(secret, counter);
    // Constant-time comparison so response timing cannot leak digit prefixes.
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(code, 'utf8');
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return { valid: true, counter };
    }
  }

  return { valid: false, counter: null };
}

/**
 * Build the `otpauth://` URI an authenticator app scans.
 *
 * The label identifies the account; the issuer is what the app displays as the
 * service name.
 */
export function buildTotpUri(params: {
  secretBase32: string;
  accountName: string;
  issuer?: string;
}): string {
  const issuer = params.issuer ?? 'Jibli';
  const label = encodeURIComponent(`${issuer}:${params.accountName}`);
  const query = new URLSearchParams({
    secret: params.secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(CODE_DIGITS),
    period: String(TIME_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

/**
 * Recovery codes (plan §88).
 *
 * "Recovery codes and account-recovery procedures are securely managed."
 * Shown exactly once at enrolment, stored hashed, and each is single-use.
 */
export const RECOVERY_CODE_COUNT = 10;

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    // 10 hex characters ≈ 40 bits: infeasible to guess, short enough to write
    // on paper and read back correctly.
    const raw = randomBytes(5).toString('hex').toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/** Hash a recovery code for storage. Normalised so formatting never matters. */
export function hashRecoveryCode(code: string, pepper: string): string {
  const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return createHmac('sha256', pepper).update(`recovery:${normalized}`).digest('hex');
}
