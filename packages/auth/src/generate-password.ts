import { randomBytes } from 'node:crypto';
import { checkPasswordPolicy } from './password.js';

/**
 * Generate a first password for a portal account.
 *
 * Two constraints pull against each other. It has to be strong, and it has to
 * survive being read aloud down a phone line to a restaurant owner and typed
 * back correctly — because that is how these are actually delivered.
 *
 * So: a restricted alphabet with no character that is ambiguous when spoken or
 * seen (no O/0, no l/1/I), grouped in fours with hyphens, and a digit group
 * guaranteed rather than left to chance.
 *
 * It also has to *pass the policy it will be judged by*. An earlier version
 * prefixed every password with `Jibli-`, which the policy rejects as a
 * product-name pattern — every account creation would have failed with an
 * internal error. Hence the assertion at the end: this function refuses to
 * return something the server would reject.
 */

/**
 * Unambiguous characters only.
 *
 * Removed: O and 0, l and 1 and I, and the vowels that turn a random string
 * into an unintended word when they happen to line up.
 */
const CONSONANTS = 'bcdfghjkmnpqrstvwxyz';
const DIGITS = '23456789';

/**
 * Uniform pick, without modulo bias.
 *
 * `randomBytes(1)[0] % alphabet.length` is subtly skewed toward the first
 * characters whenever 256 is not a multiple of the length. Rejecting the tail
 * removes that.
 */
function pick(alphabet: string): string {
  const limit = 256 - (256 % alphabet.length);
  for (;;) {
    const byte = randomBytes(1)[0]!;
    if (byte < limit) return alphabet[byte % alphabet.length]!;
  }
}

function group(alphabet: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += pick(alphabet);
  return out;
}

export interface GeneratePasswordOptions {
  /** Rejected if the password contains it, so it is checked here too. */
  readonly username?: string;
  /** Defaults to the standard portal minimum. */
  readonly minLength?: number;
}

/**
 * Four groups of four letters plus a digit group: 21 characters.
 *
 * Entropy is roughly 16 × log2(20) + 4 × log2(8) ≈ 81 bits. Well beyond what
 * an online attacker can reach against a rate-limited, locking endpoint, and
 * it stays readable: "bqxt - mnhd - rkfw - vzpc - 7342".
 */
export function generatePortalPassword(options: GeneratePasswordOptions = {}): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = [
      group(CONSONANTS, 4),
      group(CONSONANTS, 4),
      group(CONSONANTS, 4),
      group(CONSONANTS, 4),
      group(DIGITS, 4),
    ].join('-');

    const policy = checkPasswordPolicy(candidate, {
      ...(options.minLength !== undefined ? { minLength: options.minLength } : {}),
      ...(options.username !== undefined ? { username: options.username } : {}),
    });

    if (policy.ok) return candidate;
  }

  /*
   * Unreachable in practice: the shape above satisfies every rule by
   * construction, and 100 draws failing would mean the policy changed
   * underneath this function. Throwing is right — silently returning a
   * password the server will reject is how the `Jibli-` bug behaved.
   */
  throw new Error(
    'generatePortalPassword: no candidate satisfied the password policy after 100 attempts',
  );
}
