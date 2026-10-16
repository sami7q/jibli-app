import { and, desc, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import {
  adminNotificationReads,
  adminNotifications,
  deliveryAssignments,
  orders,
  platformConfig,
  restaurants,
  uuidv7,
} from '@jibli/db';
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

/** Fallback acceptance window when platform_config has none (config-service default). */
const DEFAULT_ACCEPTANCE_TIMEOUT_MINUTES = 10;

/** An assignment in one of these is still live — the courier has not picked up yet. */
const NOT_YET_COLLECTED = ['ASSIGNED', 'ACCEPTED'] as const;

export interface StalledOrdersSummary {
  readonly checked: number;
  readonly notified: number;
}

/**
 * The configured acceptance window, read straight from platform_config.
 *
 * The API caches this behind `getConfig`, but the worker has no AppContext, so
 * it reads the row itself and falls back to the documented default
 * (config-service.ts) when the key is unset.
 */
async function acceptanceTimeoutMs(ctx: WorkerContext): Promise<number> {
  const [row] = await ctx.db
    .select({ value: platformConfig.value })
    .from(platformConfig)
    .where(eq(platformConfig.key, 'order_acceptance_timeout_minutes'))
    .limit(1);
  const minutes = typeof row?.value === 'number' ? row.value : DEFAULT_ACCEPTANCE_TIMEOUT_MINUTES;
  return minutes * 60_000;
}

/**
 * Upsert one admin alert, keyed on its dedupe key, and re-surface it unread so a
 * growing wait actually escalates rather than sitting read at the bottom. Shared
 * by every kind of stall this sweep raises.
 */
async function raiseStalledAlert(
  ctx: WorkerContext,
  params: {
    dedupeKey: string;
    titleAr: string;
    bodyAr: string;
    orderId: string;
    restaurantId: string;
    now: Date;
  },
): Promise<void> {
  const notificationId = uuidv7();
  const [row] = await ctx.db
    .insert(adminNotifications)
    .values({
      id: notificationId,
      kind: 'ORDER_STALLED',
      severity: 'URGENT',
      titleAr: params.titleAr,
      bodyAr: params.bodyAr,
      linkPath: `/orders/${params.orderId}`,
      entityType: 'order',
      entityId: params.orderId,
      restaurantId: params.restaurantId,
      dedupeKey: params.dedupeKey,
    })
    .onConflictDoUpdate({
      target: adminNotifications.dedupeKey,
      targetWhere: isNotNull(adminNotifications.dedupeKey),
      set: { bodyAr: params.bodyAr, severity: 'URGENT', createdAt: params.now },
    })
    .returning({ id: adminNotifications.id });

  if (row && row.id !== notificationId) {
    await ctx.db
      .delete(adminNotificationReads)
      .where(eq(adminNotificationReads.notificationId, row.id));
  }
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
    const acceptanceCutoff = new Date(now.getTime() - (await acceptanceTimeoutMs(ctx)));
    let checked = 0;
    let notified = 0;

    // ── READY orders going nowhere (FLOW-5) ─────────────────────────────────
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

    for (const order of stalled) {
      checked += 1;
      const waitingMinutes = order.readyAt
        ? Math.floor((now.getTime() - order.readyAt.getTime()) / 60_000)
        : 0;

      /*
       * A courier assigned to a READY order who never collects it is a stall
       * too — the order looks handled but is not progressing (FLOW-5). The body
       * reflects which case it is and tracks the growing wait, because the
       * assigned-but-stuck case is exactly the one the "no driver" wording would
       * hide.
       */
      const [assignment] = await ctx.db
        .select({ status: deliveryAssignments.status })
        .from(deliveryAssignments)
        .where(
          and(
            eq(deliveryAssignments.orderId, order.id),
            inArray(deliveryAssignments.status, [...NOT_YET_COLLECTED]),
          ),
        )
        .orderBy(desc(deliveryAssignments.assignedAt))
        .limit(1);

      const bodyAr = assignment
        ? `${order.restaurantName} — الطلب جاهز منذ ${waitingMinutes} دقيقة، ` +
          `أُسنِد إلى مندوب ولم يُستلم من المتجر بعد.`
        : `${order.restaurantName} — الطلب جاهز منذ ${waitingMinutes} دقيقة ` +
          `ولم يُسنَد إلى مندوب بعد.`;

      await raiseStalledAlert(ctx, {
        dedupeKey: `order_stalled:${order.id}`,
        titleAr: assignment
          ? `طلب #${order.publicOrderNumber} جاهز ولم يُستلم`
          : `طلب #${order.publicOrderNumber} جاهز بلا مندوب`,
        bodyAr,
        orderId: order.id,
        restaurantId: order.restaurantId,
        now,
      });
      notified += 1;
    }

    // ── Orders the shop never accepted (FLOW-4) ─────────────────────────────
    // `order_acceptance_timeout_minutes` existed and was read by nothing; an
    // order nobody accepts sat at «طلب جديد» forever while the customer watched
    // a stale ETA. Raise an alert past the window (an operator decides whether
    // to chase or cancel — the same non-intervening stance the READY sweep
    // takes).
    const pending = await ctx.db
      .select({
        id: orders.id,
        publicOrderNumber: orders.publicOrderNumber,
        restaurantId: orders.restaurantId,
        restaurantName: restaurants.displayName,
        placedAt: orders.placedAt,
      })
      .from(orders)
      .innerJoin(restaurants, eq(orders.restaurantId, restaurants.id))
      .where(and(eq(orders.status, 'PENDING_RESTAURANT'), lt(orders.placedAt, acceptanceCutoff)));

    for (const order of pending) {
      checked += 1;
      const waitingMinutes = Math.floor((now.getTime() - order.placedAt.getTime()) / 60_000);
      await raiseStalledAlert(ctx, {
        dedupeKey: `order_acceptance_timeout:${order.id}`,
        titleAr: `طلب #${order.publicOrderNumber} لم يُقبل بعد`,
        bodyAr:
          `${order.restaurantName} — لم يقبل المتجر الطلب منذ ${waitingMinutes} دقيقة. ` +
          `قد يحتاج الزبون إلى متابعة أو إلغاء.`,
        orderId: order.id,
        restaurantId: order.restaurantId,
        now,
      });
      notified += 1;
    }

    summary = { checked, notified };
    if (notified > 0) {
      ctx.logger.warn(
        {
          event: 'orders.stalled',
          readyCount: stalled.length,
          pendingCount: pending.length,
          thresholdMinutes: STALLED_AFTER_MS / 60_000,
        },
        'Orders stalled: ready with no progress, or never accepted',
      );
    }
  });

  return ran ? summary : null;
}
