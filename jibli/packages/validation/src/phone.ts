import { normalizeDigits } from './arabic.js';

/**
 * Iraqi phone numbers.
 *
 * Plan §10: normalize Arabic-Indic digits, normalize to E.164 for storage, show
 * +964 clearly in the Arabic UI, reject malformed values.
 *
 * Iraqi mobile numbers are 10 digits nationally, written as 07XXXXXXXX. In E.164
 * the leading trunk zero is dropped: +9647XXXXXXXX (13 characters).
 */

export const IRAQ_COUNTRY_CODE = '964';
export const IRAQ_DIAL_PREFIX = '+964';

/**
 * Mobile network prefixes in service in Iraq, as the national 3-digit form.
 * Zain (078/079), Asiacell (077/078), Korek (075/076), and the Kurdistan-region
 * operators. 072 is included for Itisaluna/other licensed operators.
 */
const IRAQI_MOBILE_PREFIXES = ['070', '071', '072', '073', '074', '075', '076', '077', '078', '079'];

export class PhoneValidationError extends Error {
  constructor(
    message: string,
    public readonly code: 'PHONE_MALFORMED' | 'PHONE_NOT_IRAQI' | 'PHONE_NOT_MOBILE',
  ) {
    super(message);
    this.name = 'PhoneValidationError';
  }
}

/**
 * Strip everything a human might type around a number: spaces, dashes,
 * parentheses, dots, and non-breaking spaces. Arabic-Indic digits are folded
 * to ASCII first so ٠٧٧١ and 0771 converge.
 */
const SEPARATORS = /[\s\-().\u00A0\u2000-\u200A\u202F]/g;

function stripFormatting(input: string): string {
  return normalizeDigits(input).replace(SEPARATORS, '');
}

/**
 * Convert any accepted Iraqi input form to E.164, or throw.
 *
 * Accepted inputs:
 *   07712345678      national trunk form
 *   7712345678       national without trunk zero
 *   +9647712345678   E.164
 *   009647712345678  international access form
 *   9647712345678    country code without plus
 */
export function toE164Iraq(input: string): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new PhoneValidationError('Phone number is required', 'PHONE_MALFORMED');
  }

  let digits = stripFormatting(input);

  // Normalize the international prefix forms down to a bare country code.
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);

  if (!/^\d+$/.test(digits)) {
    throw new PhoneValidationError('Phone number contains invalid characters', 'PHONE_MALFORMED');
  }

  let national: string;
  if (digits.startsWith(IRAQ_COUNTRY_CODE)) {
    const rest = digits.slice(IRAQ_COUNTRY_CODE.length);
    // A number written +964 07... carries a redundant trunk zero; drop it.
    national = rest.startsWith('0') ? rest : `0${rest}`;
  } else if (digits.startsWith('0')) {
    national = digits;
  } else if (digits.length === 9 || digits.length === 10) {
    // Subscriber number typed without the trunk zero. Nine digits is one short of
    // Iraq's 10-digit mobile plan and is caught by the length check below.
    national = `0${digits}`;
  } else {
    throw new PhoneValidationError('Phone number is not a valid Iraqi number', 'PHONE_NOT_IRAQI');
  }

  if (national.length !== 11) {
    throw new PhoneValidationError(
      'Iraqi mobile numbers must have 10 national digits',
      'PHONE_MALFORMED',
    );
  }

  const prefix = national.slice(0, 3);
  if (!IRAQI_MOBILE_PREFIXES.includes(prefix)) {
    throw new PhoneValidationError(
      `Unsupported Iraqi mobile prefix: ${prefix}`,
      'PHONE_NOT_MOBILE',
    );
  }

  // Drop the trunk zero for E.164.
  return `+${IRAQ_COUNTRY_CODE}${national.slice(1)}`;
}

/** Non-throwing variant for form validation and bulk imports. */
export function tryToE164Iraq(input: string): { ok: true; value: string } | { ok: false; code: string } {
  try {
    return { ok: true, value: toE164Iraq(input) };
  } catch (error) {
    if (error instanceof PhoneValidationError) return { ok: false, code: error.code };
    return { ok: false, code: 'PHONE_MALFORMED' };
  }
}

export function isValidIraqiPhone(input: string): boolean {
  return tryToE164Iraq(input).ok;
}

/**
 * Display form used across the Arabic UI and the reference designs:
 * "+964 771 234 5678".
 */
export function formatIraqiPhoneDisplay(e164: string): string {
  const subscriber = e164.replace(`+${IRAQ_COUNTRY_CODE}`, '');
  if (subscriber.length !== 10) return e164;
  return `${IRAQ_DIAL_PREFIX} ${subscriber.slice(0, 3)} ${subscriber.slice(3, 6)} ${subscriber.slice(6)}`;
}

/** National form restaurants and drivers recognise: "0771 234 5678". */
export function formatIraqiPhoneNational(e164: string): string {
  const subscriber = e164.replace(`+${IRAQ_COUNTRY_CODE}`, '');
  if (subscriber.length !== 10) return e164;
  return `0${subscriber.slice(0, 3)} ${subscriber.slice(3, 6)} ${subscriber.slice(6)}`;
}

/**
 * Mask for support agents and logs (plan §84, §89): keep the operator prefix and
 * the last two digits, hide the rest. "+964 77• ••• ••78".
 */
export function maskPhone(e164: string): string {
  const subscriber = e164.replace(`+${IRAQ_COUNTRY_CODE}`, '');
  if (subscriber.length !== 10) return '+964••••••••••';
  return `${IRAQ_DIAL_PREFIX} ${subscriber.slice(0, 2)}• ••• ••${subscriber.slice(8)}`;
}
