import { AppError, ERROR_CODES } from '@jibli/contracts';
import { hashShortCode, safeCompare } from '@jibli/auth';
import { normalizeDigits } from '@jibli/validation';

/**
 * Delivery PIN (plan §52).
 *
 * Properties the plan requires:
 *   - randomly generated
 *   - stored hashed
 *   - tied to the order
 *   - visible to the customer inside the app
 *   - never visible to the driver or restaurant staff
 *   - attempt-limited
 *   - never logged
 *
 * The PIN's job is to prove the driver reached the right customer. It is a
 * 4-digit secret, so hashing alone is not protection — the attempt limit is what
 * makes guessing infeasible, and the order ID is mixed into the hash as a salt
 * so one order's PIN hash says nothing about another's.
 */

export const DELIVERY_PIN_LENGTH = 4;
export const DELIVERY_PIN_MAX_ATTEMPTS = 5;

/** Hash a PIN for storage. The order ID salts it; the pepper is server-only. */
export function hashDeliveryPin(pin: string, orderId: string, pepper: string): string {
  return hashShortCode(pin, pepper, `delivery_pin:${orderId}`);
}

export interface PinVerificationInput {
  readonly submittedPin: string;
  readonly storedHash: string | null;
  readonly orderId: string;
  readonly pepper: string;
  readonly currentAttempts: number;
  readonly maxAttempts?: number;
}

export interface PinVerificationResult {
  readonly valid: boolean;
  readonly attemptsRemaining: number;
}

/**
 * Verify a submitted PIN.
 *
 * Throws on exhaustion rather than returning `valid: false`, so a caller cannot
 * accidentally treat "out of attempts" as an ordinary wrong-PIN retry.
 */
export function verifyDeliveryPin(input: PinVerificationInput): PinVerificationResult {
  const maxAttempts = input.maxAttempts ?? DELIVERY_PIN_MAX_ATTEMPTS;

  if (input.currentAttempts >= maxAttempts) {
    throw new AppError(ERROR_CODES.DELIVERY_PIN_ATTEMPTS_EXCEEDED, {
      details: { maxAttempts },
    });
  }

  if (!input.storedHash) {
    // The order has no PIN — the feature flag was off when it was placed.
    // Callers must decide whether that is acceptable; it is never a pass here.
    throw new AppError(ERROR_CODES.DELIVERY_PIN_INVALID, {
      details: { reason: 'NO_PIN_ON_ORDER' },
    });
  }

  // Arabic-Indic digits must verify identically to ASCII ones.
  const normalized = normalizeDigits(input.submittedPin).trim();
  if (!/^\d+$/.test(normalized)) {
    return { valid: false, attemptsRemaining: maxAttempts - input.currentAttempts - 1 };
  }

  const candidate = hashDeliveryPin(normalized, input.orderId, input.pepper);
  const valid = safeCompare(candidate, input.storedHash);

  return {
    valid,
    attemptsRemaining: valid
      ? maxAttempts - input.currentAttempts
      : maxAttempts - input.currentAttempts - 1,
  };
}

/**
 * Manager/support override (plan §52).
 *
 * "A manager/support override exists for exceptional cases and is strongly
 * audited." The override is a deliberate, reasoned action — never a silent
 * bypass — so a reason is mandatory here rather than optional.
 */
export function assertOverrideAllowed(reason: string | null | undefined): string {
  const trimmed = reason?.trim();
  if (!trimmed || trimmed.length < 10) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      details: {
        field: 'reason',
        message: 'A delivery-PIN override requires a written reason of at least 10 characters',
      },
    });
  }
  return trimmed;
}
