import { and, eq, lt } from 'drizzle-orm';
import { AppError, ERROR_CODES } from '@jibli/contracts';
import { hashRequestBody } from '@jibli/auth';
import { idempotencyKeys, uuidv7, type Database, type DbExecutor } from '@jibli/db';

/**
 * Idempotency (plan §28).
 *
 * "If a customer's network times out after Place Order, the app checks the
 * result using the same idempotency key rather than blindly creating another
 * order."
 *
 * The guarantee rests on the unique index on (scope, key): two concurrent
 * requests race to INSERT, exactly one wins, and the loser replays the winner's
 * result. Checking-then-inserting without that index would still double-charge
 * under concurrency.
 */

export const IDEMPOTENCY_SCOPES = {
  PLACE_ORDER: 'place_order',
  CONFIRM_DELIVERY: 'confirm_delivery',
  RECORD_PAYMENT: 'record_payment',
  DRIVER_CASH_HANDOVER: 'driver_cash_handover',
  COMMISSION_ADJUSTMENT: 'commission_adjustment',
  COUPON_REDEMPTION: 'coupon_redemption',
  SETTLEMENT_GENERATION: 'settlement_generation',
} as const;

export type IdempotencyScope = (typeof IDEMPOTENCY_SCOPES)[keyof typeof IDEMPOTENCY_SCOPES];

/** How long a key is honoured before it may be reused. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export type IdempotencyOutcome<T> =
  | { readonly kind: 'REPLAYED'; readonly response: T }
  /** Another request holds the key and has not finished — the client should retry. */
  | { readonly kind: 'IN_PROGRESS' }
  | { readonly kind: 'PROCEED' };

/**
 * Claim a key before doing the work.
 *
 * Returns REPLAYED with the stored response when the operation already
 * completed, IN_PROGRESS when a concurrent attempt holds the claim, and PROCEED
 * when this caller owns it and must go on to do the work.
 */
export async function claimIdempotencyKey<T>(
  db: Database,
  params: {
    key: string;
    scope: IdempotencyScope;
    userId: string | null;
    requestBody: unknown;
  },
): Promise<IdempotencyOutcome<T>> {
  const requestHash = hashRequestBody(params.requestBody);

  const existing = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.scope, params.scope), eq(idempotencyKeys.key, params.key)))
    .limit(1);

  const record = existing[0];
  if (record) {
    // The same key with a different payload is a client bug, not a retry.
    // Replaying the old response would hide it; creating new state would
    // duplicate money. Refusing is the only safe answer.
    if (record.requestHash !== requestHash) {
      throw new AppError(ERROR_CODES.IDEMPOTENCY_KEY_REUSED, {
        details: { scope: params.scope },
      });
    }
    if (record.status === 'COMPLETED' && record.responseJson) {
      return { kind: 'REPLAYED', response: record.responseJson as T };
    }
    if (record.status === 'IN_PROGRESS') {
      // Expired claims are reclaimable: a crashed request must not block a key forever.
      if (record.expiresAt.getTime() > Date.now()) {
        return { kind: 'IN_PROGRESS' };
      }
    }
    // FAILED or expired: let this caller try again under the same key.
    await db
      .update(idempotencyKeys)
      .set({
        status: 'IN_PROGRESS',
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
        updatedAt: new Date(),
      })
      .where(eq(idempotencyKeys.id, record.id));
    return { kind: 'PROCEED' };
  }

  try {
    await db.insert(idempotencyKeys).values({
      id: uuidv7(),
      key: params.key,
      scope: params.scope,
      userId: params.userId,
      requestHash,
      status: 'IN_PROGRESS',
      expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
    });
    return { kind: 'PROCEED' };
  } catch (error) {
    // Lost the insert race. The unique index did its job; the winner is running.
    if (isUniqueViolation(error)) return { kind: 'IN_PROGRESS' };
    throw error;
  }
}

/** Store the successful result so a later retry replays it verbatim. */
export async function completeIdempotencyKey(
  tx: DbExecutor,
  params: { key: string; scope: IdempotencyScope; response: unknown; resultEntityId?: string },
): Promise<void> {
  await tx
    .update(idempotencyKeys)
    .set({
      status: 'COMPLETED',
      responseJson: params.response as Record<string, unknown>,
      resultEntityId: params.resultEntityId ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(idempotencyKeys.scope, params.scope), eq(idempotencyKeys.key, params.key)));
}

/** Release a claim after a failure so the client can genuinely retry. */
export async function failIdempotencyKey(
  db: Database,
  params: { key: string; scope: IdempotencyScope },
): Promise<void> {
  await db
    .update(idempotencyKeys)
    .set({ status: 'FAILED', updatedAt: new Date() })
    .where(and(eq(idempotencyKeys.scope, params.scope), eq(idempotencyKeys.key, params.key)));
}

/** Scheduled cleanup of expired keys (plan §94). */
export async function purgeExpiredIdempotencyKeys(db: Database): Promise<number> {
  const deleted = await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.expiresAt, new Date()))
    .returning({ id: idempotencyKeys.id });
  return deleted.length;
}

/** PostgreSQL unique-violation SQLSTATE. */
export const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/** Name the constraint a unique violation hit, so callers can branch on it. */
export function uniqueViolationConstraint(error: unknown): string | null {
  if (!isUniqueViolation(error)) return null;
  const candidate = error as { constraint_name?: unknown; constraint?: unknown };
  const name = candidate.constraint_name ?? candidate.constraint;
  return typeof name === 'string' ? name : null;
}
