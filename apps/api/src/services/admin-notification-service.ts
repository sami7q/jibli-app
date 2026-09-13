import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import {
  adminNotificationReads,
  adminNotifications,
  uuidv7,
  type AdminNotificationKind,
  type AdminNotificationSeverity,
  type DbExecutor,
} from '@jibli/db';
import type { AppContext } from '../lib/context.js';

/**
 * The Admin bell.
 *
 * Something happens on the platform — a restaurant applies, asks to go live,
 * sends a support message — and until now nothing told anyone. The row sat in
 * the database waiting for somebody to think of checking the right screen.
 *
 * Three rules this service exists to hold:
 *
 *   1. Writing a notification must never fail the thing it is about. A bell
 *      entry is a convenience; an application is a fact. So `notifyAdmins`
 *      swallows its own errors and says so in the log.
 *
 *   2. Repeats collapse. A restaurant that sends four messages before anyone
 *      looks leaves one unread entry, not four — the operator opens the thread
 *      and reads all four. That is what `dedupeKey` is for, and why it is
 *      reset rather than duplicated when it fires again.
 *
 *   3. Read state is per operator. Two people on duty must be able to have
 *      seen something independently.
 */

export interface AdminNotificationInput {
  readonly kind: AdminNotificationKind;
  readonly titleAr: string;
  readonly bodyAr?: string | null;
  readonly severity?: AdminNotificationSeverity;
  readonly linkPath?: string | null;
  readonly entityType?: string | null;
  readonly entityId?: string | null;
  readonly restaurantId?: string | null;
  /**
   * Repeats of the same thing share this. Firing again on an existing key
   * refreshes the entry and clears who had read it, so it returns to the top
   * unread rather than staying quietly marked as seen.
   */
  readonly dedupeKey?: string | null;
}

/**
 * Record something for whoever is on duty.
 *
 * Takes an executor so it can join the caller's transaction: a notification
 * about an order that was rolled back should roll back with it. Callers
 * outside a transaction pass `ctx.db`.
 */
export async function notifyAdmins(
  ctx: AppContext,
  input: AdminNotificationInput,
  executor: DbExecutor = ctx.db,
): Promise<void> {
  try {
    const notificationId = uuidv7();
    const values = {
      id: notificationId,
      kind: input.kind,
      severity: input.severity ?? 'INFO',
      titleAr: input.titleAr,
      bodyAr: input.bodyAr ?? null,
      linkPath: input.linkPath ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      restaurantId: input.restaurantId ?? null,
      dedupeKey: input.dedupeKey ?? null,
    };

    /*
     * Two paths, because the unique index is partial — it covers only rows
     * that carry a key. Most notifications do not: an application and a
     * one-star review are each their own event, and pointing an upsert at a
     * column that is null on both would ask Postgres to treat every keyless
     * notification as a repeat of the last.
     */
    if (!input.dedupeKey) {
      await executor.insert(adminNotifications).values(values);
      return;
    }

    const [row] = await executor
      .insert(adminNotifications)
      .values(values)
      .onConflictDoUpdate({
        target: adminNotifications.dedupeKey,
        // The index predicate, restated. Without it Postgres answers "no
        // unique or exclusion constraint matching the ON CONFLICT
        // specification" and the notification is silently lost.
        targetWhere: isNotNull(adminNotifications.dedupeKey),
        set: {
          titleAr: input.titleAr,
          bodyAr: input.bodyAr ?? null,
          severity: input.severity ?? 'INFO',
          createdAt: new Date(),
        },
      })
      .returning({ id: adminNotifications.id });

    /*
     * A repeat that updated an existing row must become unread again. Without
     * this, the second message on a thread an operator had already dismissed
     * would never raise the bell — the one case where a repeat matters most.
     */
    if (row && row.id !== notificationId) {
      await executor
        .delete(adminNotificationReads)
        .where(eq(adminNotificationReads.notificationId, row.id));
    }
  } catch (error) {
    // Never the reason the underlying action fails.
    ctx.logger.error(
      { event: 'admin_notification.write_failed', kind: input.kind, err: String(error) },
      'Could not record an Admin notification',
    );

    /*
     * Except under test, where swallowing is the wrong trade.
     *
     * This rule is not hypothetical: the first version of the upsert above
     * targeted a partial index without restating its predicate, Postgres
     * refused every write, and the only symptom was a bell that stayed at
     * zero. Silence is right in production and useless in a test suite.
     */
    if (process.env.NODE_ENV === 'test') throw error;
  }
}

/** How many notifications this operator has not seen. */
export async function unreadCount(ctx: AppContext, userId: string): Promise<number> {
  const [row] = await ctx.db
    .select({ value: sql<number>`COUNT(*)` })
    .from(adminNotifications)
    .leftJoin(
      adminNotificationReads,
      and(
        eq(adminNotificationReads.notificationId, adminNotifications.id),
        eq(adminNotificationReads.userId, userId),
      ),
    )
    .where(isNull(adminNotificationReads.id));

  return Number(row?.value ?? 0);
}

export interface AdminNotificationView {
  readonly id: string;
  readonly kind: AdminNotificationKind;
  readonly severity: AdminNotificationSeverity;
  readonly title_ar: string;
  readonly body_ar: string | null;
  readonly link_path: string | null;
  readonly is_read: boolean;
  readonly created_at: string;
}

/** The newest notifications, each carrying whether *this* operator has seen it. */
export async function listNotifications(
  ctx: AppContext,
  userId: string,
  options: { limit: number; unreadOnly: boolean },
): Promise<AdminNotificationView[]> {
  const rows = await ctx.db
    .select({
      id: adminNotifications.id,
      kind: adminNotifications.kind,
      severity: adminNotifications.severity,
      titleAr: adminNotifications.titleAr,
      bodyAr: adminNotifications.bodyAr,
      linkPath: adminNotifications.linkPath,
      createdAt: adminNotifications.createdAt,
      readId: adminNotificationReads.id,
    })
    .from(adminNotifications)
    .leftJoin(
      adminNotificationReads,
      and(
        eq(adminNotificationReads.notificationId, adminNotifications.id),
        eq(adminNotificationReads.userId, userId),
      ),
    )
    .where(options.unreadOnly ? isNull(adminNotificationReads.id) : undefined)
    .orderBy(desc(adminNotifications.createdAt))
    .limit(options.limit);

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    title_ar: row.titleAr,
    body_ar: row.bodyAr,
    link_path: row.linkPath,
    is_read: row.readId !== null,
    created_at: row.createdAt.toISOString(),
  }));
}

/** Mark specific notifications, or everything, as seen by this operator. */
export async function markRead(
  ctx: AppContext,
  userId: string,
  notificationIds: string[] | 'ALL',
): Promise<number> {
  const target =
    notificationIds === 'ALL'
      ? ctx.db.select({ id: adminNotifications.id }).from(adminNotifications)
      : ctx.db
          .select({ id: adminNotifications.id })
          .from(adminNotifications)
          .where(inArray(adminNotifications.id, notificationIds));

  const rows = await target;
  if (rows.length === 0) return 0;

  const inserted = await ctx.db
    .insert(adminNotificationReads)
    .values(
      rows.map((row) => ({
        id: uuidv7(),
        notificationId: row.id,
        userId,
      })),
    )
    // Already read by this operator: nothing to do, and not an error.
    .onConflictDoNothing()
    .returning({ id: adminNotificationReads.id });

  return inserted.length;
}

/**
 * Drop notifications older than the retention window.
 *
 * The bell is a work queue, not an archive — the audit log is the archive. An
 * unbounded table would make the unread count a growing scan of rows nobody
 * will ever open.
 */
export async function pruneNotifications(ctx: AppContext, olderThanDays = 60): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const deleted = await ctx.db
    .delete(adminNotifications)
    .where(lt(adminNotifications.createdAt, cutoff))
    .returning({ id: adminNotifications.id });
  return deleted.length;
}
