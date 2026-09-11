import { and, eq, lt, or, sql } from 'drizzle-orm';
import { generateToken, jobLocks, uuidv7 } from '@jibli/db';
import type { WorkerContext } from '../context.js';

/**
 * Distributed job locking (plan §94).
 *
 * "Distributed locking prevents two worker instances from generating the same
 * settlement. Database uniqueness remains the final protection."
 *
 * The lock lives in PostgreSQL rather than Redis: a Redis flush or failover
 * would quietly drop a lock, and the jobs guarded here move money.
 */

export async function acquireJobLock(
  ctx: WorkerContext,
  lockKey: string,
  ttlMs: number,
): Promise<string | null> {
  const ownerToken = generateToken(16);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  try {
    // Take the lock, or steal one whose holder died and let it expire.
    const inserted = await ctx.db
      .insert(jobLocks)
      .values({ id: uuidv7(), lockKey, ownerToken, acquiredAt: now, expiresAt })
      .onConflictDoUpdate({
        target: jobLocks.lockKey,
        set: { ownerToken, acquiredAt: now, expiresAt },
        where: lt(jobLocks.expiresAt, now),
      })
      .returning({ ownerToken: jobLocks.ownerToken });

    // An empty result means the conflict target matched but the WHERE did not:
    // someone else holds a live lock.
    return inserted[0]?.ownerToken === ownerToken ? ownerToken : null;
  } catch {
    return null;
  }
}

/** Release only if still the owner — never stamp on a lock that was stolen. */
export async function releaseJobLock(
  ctx: WorkerContext,
  lockKey: string,
  ownerToken: string,
): Promise<void> {
  await ctx.db
    .delete(jobLocks)
    .where(and(eq(jobLocks.lockKey, lockKey), eq(jobLocks.ownerToken, ownerToken)));
}

/** Extend a lock for a long-running job so it is not stolen mid-flight. */
export async function renewJobLock(
  ctx: WorkerContext,
  lockKey: string,
  ownerToken: string,
  ttlMs: number,
): Promise<boolean> {
  const renewed = await ctx.db
    .update(jobLocks)
    .set({ expiresAt: new Date(Date.now() + ttlMs) })
    .where(and(eq(jobLocks.lockKey, lockKey), eq(jobLocks.ownerToken, ownerToken)))
    .returning({ id: jobLocks.id });
  return renewed.length > 0;
}

/**
 * Run `fn` while holding a lock. Returns false when the lock was unavailable.
 * The lock is always released, including when `fn` throws.
 */
export async function withJobLock(
  ctx: WorkerContext,
  lockKey: string,
  ttlMs: number,
  fn: () => Promise<void>,
): Promise<boolean> {
  const token = await acquireJobLock(ctx, lockKey, ttlMs);
  if (!token) return false;

  try {
    await fn();
    return true;
  } finally {
    await releaseJobLock(ctx, lockKey, token);
  }
}

/** Clear locks whose holder crashed, so a job is not blocked forever. */
export async function purgeExpiredLocks(ctx: WorkerContext): Promise<number> {
  const deleted = await ctx.db
    .delete(jobLocks)
    .where(or(lt(jobLocks.expiresAt, new Date()), sql`false`))
    .returning({ id: jobLocks.id });
  return deleted.length;
}
