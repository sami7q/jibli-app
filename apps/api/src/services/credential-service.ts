import { eq } from 'drizzle-orm';
import { loginAttempts, users, uuidv7 } from '@jibli/db';
import { AppError, ERROR_CODES } from '@jibli/contracts';
import type { AppContext } from '../lib/context.js';

/**
 * The parts of password authentication that must be identical everywhere.
 *
 * There are two password sign-ins now — staff with a username, customers with a
 * phone number — and every rule below is one that stops working the moment the
 * two copies disagree. A lockout threshold of six in one file and five in
 * another is not a small inconsistency: it is an attacker's budget, and nobody
 * reviewing either file alone would see it.
 *
 * Extracted from `routes/portal-auth.ts`, which held the only copy.
 */

/** Wrong passwords before the account stops answering. */
export const MAX_FAILED_LOGINS = 6;
export const LOCKOUT_MINUTES = 15;

/**
 * A real Argon2id hash of a value nobody knows.
 *
 * Verified against when the account does not exist, so that path costs the same
 * as a genuine check. Without it, "unknown number" returns in microseconds and
 * "wrong password" in ~50ms, which is enough to enumerate which phone numbers
 * hold accounts — the enumeration the uniform error message exists to prevent.
 */
export const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Vc0QqGZVXKD8mQJc0wYqzRUHtTXhF4pFfJFYPnxvHXk';

/**
 * Record a sign-in attempt for the security log (plan §78).
 *
 * Never throws: telemetry must not be able to turn a successful login into a
 * 500, nor a failed one into a different error than the uniform message.
 */
export async function recordLoginAttempt(
  ctx: AppContext,
  params: {
    userId: string | null;
    identifier: string;
    succeeded: boolean;
    failureReason: string | null;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  try {
    await ctx.db.insert(loginAttempts).values({
      id: uuidv7(),
      userId: params.userId,
      identifier: params.identifier,
      succeeded: params.succeeded,
      failureReason: params.failureReason,
      ip: params.ip,
      userAgent: params.userAgent,
    });
  } catch (error) {
    ctx.logger.warn({ event: 'login_attempt.record_failed', err: error }, 'could not log attempt');
  }
}

/**
 * Refuse a locked account before the password is checked.
 *
 * Order matters and is the whole point: checking the password first and the
 * lock second would make a locked account answer differently for a right
 * password than for a wrong one, which turns the lockout into an oracle for
 * guessing it.
 */
export async function assertNotLockedOut(
  ctx: AppContext,
  user: { id: string; lockedUntil: Date | null } | undefined,
  attempt: { identifier: string; ip: string | null; userAgent: string | null },
): Promise<void> {
  if (!user?.lockedUntil || user.lockedUntil.getTime() <= Date.now()) return;

  await recordLoginAttempt(ctx, {
    userId: user.id,
    identifier: attempt.identifier,
    succeeded: false,
    failureReason: 'LOCKED',
    ip: attempt.ip,
    userAgent: attempt.userAgent,
  });

  throw new AppError(ERROR_CODES.RATE_LIMITED, {
    details: {
      reason: 'ACCOUNT_LOCKED',
      retryAfterSeconds: Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000),
    },
  });
}

/** Count a wrong password, and lock the account once the budget is spent. */
export async function registerFailedPassword(
  ctx: AppContext,
  user: { id: string; failedLoginCount: number },
): Promise<void> {
  const failures = user.failedLoginCount + 1;
  const locked = failures >= MAX_FAILED_LOGINS;

  await ctx.db
    .update(users)
    .set({
      failedLoginCount: failures,
      lockedUntil: locked ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
    })
    .where(eq(users.id, user.id));
}
