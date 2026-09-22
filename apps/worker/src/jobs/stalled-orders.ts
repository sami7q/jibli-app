import { and, eq, isNotNull, lt } from 'drizzle-orm';
import { adminNotificationReads, adminNotifications, orders, restaurants, uuidv7 } from '@jibli/db';
import type { WorkerContext } from '../context.js';
import { withJobLock } from './job-lock.js';

/**
 * Orders that reached READY and stopped.
 *
 * The order lifecycle had no timeout in it anywhere. Driver assignment is
 * manual — a restaurant picks one of its own couriers, there is no automatic
 * dispatch — so an order can sit at READY forever if nobody does. Every party
 * involved believes somebody else is handling it: the kitchen has cooked and
 * moved on, the customer is watching a status that will not change, and the
 * platform is not watching at all. The food goes cold and the first anybody
 * hears of it is a complaint.
 *
 * Every other scheduled job in this worker is financial. This is the first one
 * that watches an order, and it exists because "no driver was available" was a
 * silent state rather than an event.
 *
 * It does not intervene. Reassigning or cancelling on a timer would be the
 * platform making an operational decision it does not have the context for —
 * the shop may be about to assign somebody, or the courier may be two minutes
 * away with a dead phone. It raises the alert and lets a person decide, which
 * is the same principle `runDailyReconciliation` follows for money.
 */

/**
 * How long an order may sit READY before somebody is told.
 *
 * Twenty minutes: long enough that a restaurant with one courier on a round
 * trip is not reported for working normally, short enough that the food is
 * still worth delivering when an operator sees it. It is a judgement about
 * operations rather than a technical constant — confirm it against how these
 * shops actually run, and move it here if it is wrong.
 */
const STALLED_AFTER_MS = 20 * 60 * 1000;

/** The sweep is cheap, and a stalled order is time-sensitive by definition. */
export const STALLED_ORDERS_INTERVAL_MS = 5 * 60 * 1000;

export interface StalledOrdersSummary {
  readonly checked: number;
  readonly notified: number;
}

export async function runStalledOrderSweep(
  ctx: WorkerContext,
  options: { now?: Date } = {},
): Promise<StalledOrdersSummary | null> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - STALLED_AFTER_MS);

  let summary: StalledOrdersSummary = { checked: 0, notified: 0 };

  /*
   * One worker at a time. Two instances sweeping together would each write the
   * same bell entries — harmless, because `dedupeKey` collapses them, but it
   * also means two copies of every log line and twice the queries for nothing.
   */
  const ran = await withJobLock(ctx, 'stalled_orders', STALLED_ORDERS_INTERVAL_MS, async () => {
    const stalled = await ctx.db
      .select({
        id: orders.id,
        publicOrderNumber: orders.publicOrderNumber,
        restaurantId: orders.restaurantId,
        restaurantName: restaurants.displayName,
        readyAt: orders.readyAt,
      })
      .from(orders)
      .innerJoin(restaurants, eq(orders.restaurantId, restaurants.id))
      .where(
        and(
          eq(orders.status, 'READY'),
          /*
           * `ready_at` is written by the transition that set the status, so it
           * is the honest "waiting since". The null check is defensive: a row
           * migrated in, or one whose status was set by something other than
           * `transitionOrder`, would otherwise compare as stalled since the
           * epoch and be reported on every sweep forever.
           */
          isNotNull(orders.readyAt),
          lt(orders.readyAt, cutoff),
        ),
      );

    summary = { checked: stalled.length, notified: 0 };
    if (stalled.length === 0) return;

    for (const order of stalled) {
      const waitingMinutes = order.readyAt
        ? Math.floor((now.getTime() - order.readyAt.getTime()) / 60_000)
        : 0;

      /*
       * Keyed on the order, so a sweep every five minutes leaves one entry per
       * stuck order rather than one every five minutes. `notifyAdmins` resets
       * read state on a repeat, so it returns to the top unread with a fresh
       * waiting time — which is what makes the escalation visible without
       * becoming noise.
       */
      const notificationId = uuidv7();
      const bodyAr =
        `${order.restaurantName} — الطلب جاهز منذ ${waitingMinutes} دقيقة ` +
        `ولم يُسنَد إلى مندوب بعد.`;

      const [row] = await ctx.db
        .insert(adminNotifications)
        .values({
          id: notificationId,
          kind: 'ORDER_STALLED',
          severity: 'URGENT',
          titleAr: `طلب #${order.publicOrderNumber} جاهز بلا مندوب`,
          bodyAr,
          linkPath: `/orders/${order.id}`,
          entityType: 'order',
          entityId: order.id,
          restaurantId: order.restaurantId,
          dedupeKey: `order_stalled:${order.id}`,
        })
        .onConflictDoUpdate({
          target: adminNotifications.dedupeKey,
          // The index is partial and the predicate has to be restated, or
          // Postgres answers "no unique or exclusion constraint matching the
          // ON CONFLICT specification" and the alert is silently lost.
          targetWhere: isNotNull(adminNotifications.dedupeKey),
          set: { bodyAr, severity: 'URGENT', createdAt: now },
        })
        .returning({ id: adminNotifications.id });

      /*
       * A repeat that updated an existing row has to become unread again, or
       * an operator who glanced at the first alert never sees the escalation —
       * which is the one case where a repeat matters most, because the waiting
       * time in the body is the thing that changed.
       *
       * Same rule as `notifyAdmins` in the API. It is repeated rather than
       * reused because that function takes an AppContext, which this process
       * does not have.
       */
      if (row && row.id !== notificationId) {
        await ctx.db
          .delete(adminNotificationReads)
          .where(eq(adminNotificationReads.notificationId, row.id));
      }

      summary = { ...summary, notified: summary.notified + 1 };
    }

    ctx.logger.warn(
      {
        event: 'orders.stalled',
        count: stalled.length,
        thresholdMinutes: STALLED_AFTER_MS / 60_000,
        orderNumbers: stalled.map((o) => o.publicOrderNumber),
      },
      'Orders ready with no driver assigned',
    );
  });

  return ran ? summary : null;
}
