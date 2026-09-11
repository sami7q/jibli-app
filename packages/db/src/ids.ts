import { randomBytes, randomInt } from 'node:crypto';

/**
 * Identifier generation.
 *
 * Plan §25: "Use random/sortable internal IDs such as UUIDv7. Display a shorter
 * human-friendly public order number separately."
 *
 * UUIDv7 embeds a millisecond timestamp in its high bits, so primary keys are
 * time-ordered. That keeps B-tree inserts local instead of scattering writes
 * across the index the way UUIDv4 does, while staying unguessable.
 */

/**
 * Generate a UUIDv7.
 *
 * Layout (RFC 9562):
 *   48 bits  unix_ts_ms
 *    4 bits  version (7)
 *   12 bits  rand_a
 *    2 bits  variant (0b10)
 *   62 bits  rand_b
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);

  // 48-bit big-endian timestamp.
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;

  // Version 7 in the high nibble of byte 6.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  // RFC 4122 variant in the two high bits of byte 8.
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** Extract the embedded timestamp — useful in support tooling and tests. */
export function uuidv7Timestamp(uuid: string): Date {
  const hex = uuid.replace(/-/g, '').slice(0, 12);
  return new Date(Number.parseInt(hex, 16));
}

/**
 * Public order number shown to customers and restaurant staff, e.g. "JB12456"
 * as in the reference designs.
 *
 * Deliberately NOT sequential: a sequential number would leak daily order
 * volume to anyone who places two orders. Uniqueness is enforced by the database
 * index, and the caller retries on the (vanishingly rare) collision.
 */
const ORDER_NUMBER_ALPHABET = '0123456789';

export function generatePublicOrderNumber(prefix = 'JB', digits = 7): string {
  let out = '';
  for (let i = 0; i < digits; i += 1) {
    out += ORDER_NUMBER_ALPHABET[randomInt(ORDER_NUMBER_ALPHABET.length)];
  }
  return `${prefix}${out}`;
}

/** Partner code shown in the restaurant portal header, e.g. "#2847". */
export function generatePartnerCode(): string {
  return String(randomInt(1000, 10000));
}

/**
 * Numeric code for OTP and delivery PIN.
 *
 * randomInt is drawn from a CSPRNG with rejection sampling, so every code is
 * equally likely — Math.random() would be both predictable and biased here.
 */
export function generateNumericCode(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += String(randomInt(10));
  return out;
}

/** Opaque token for refresh tokens and job-lock ownership. */
export function generateToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}
