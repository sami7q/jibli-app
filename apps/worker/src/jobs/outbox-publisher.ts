import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  channels,
  EVENT_AUDIENCE,
  type EventType,
  type OrderEventPayload,
  type DeliveryEventPayload,
} from '@jibli/contracts';
import { formatIqdArabic, iqd } from '@jibli/money';
import { NOTIFICATION_TEMPLATES } from '@jibli/notifications';
import { nextAttemptDelayMs, OUTBOX_MAX_ATTEMPTS } from '@jibli/domain';
import {
  deliveryAssignments,
  drivers,
  notificationDeliveries,
  outboxEvents,
  restaurantMembers,
  restaurants,
  userDevices,
  uuidv7,
  type OutboxEventRow,
} from '@jibli/db';
import type { WorkerContext } from '../context.js';

/**
 * Outbox publisher (plan §31).
 *
 *   worker reads outbox → realtime publish → push/browser notification → mark published
 *
 * If realtime is down the order stays safely stored and the event remains
 * retryable. Client reconnection uses event IDs and order versions, so a
 * duplicate delivery cannot duplicate an alert or a state transition.
 */

export interface PublishResult {
  readonly claimed: number;
  readonly published: number;
  readonly failed: number;
}

export async function runOutboxPublisher(ctx: WorkerContext): Promise<PublishResult> {
  const now = new Date();

  /**
   * Claim a batch atomically.
   *
   * `FOR UPDATE SKIP LOCKED` is what lets several worker replicas share the
   * table without either double-publishing or blocking each other.
   */
  const claimed = await ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(outboxEvents)
      .where(
        and(
          inArray(outboxEvents.status, ['PENDING', 'PUBLISHING']),
          lte(outboxEvents.nextAttemptAt, now),
        ),
      )
      .orderBy(outboxEvents.createdAt)
      .limit(ctx.env.OUTBOX_BATCH_SIZE)
      .for('update', { skipLocked: true });

    if (rows.length === 0) return [];

    await tx
      .update(outboxEvents)
      .set({ status: 'PUBLISHING', attemptCount: sql`${outboxEvents.attemptCount} + 1` })
      .where(
        inArray(
          outboxEvents.id,
          rows.map((r) => r.id),
        ),
      );

    return rows;
  });

  let published = 0;
  let failed = 0;

  for (const event of claimed) {
    try {
      await publishEvent(ctx, event);
      await ctx.db
        .update(outboxEvents)
        .set({ status: 'PUBLISHED', publishedAt: new Date(), lastError: null })
        .where(eq(outboxEvents.id, event.id));
      published += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      const attempts = event.attemptCount + 1;

      // After the retry budget, park the row for a human rather than looping
      // forever on what is probably a permanent error (plan §93).
      const exhausted = attempts >= OUTBOX_MAX_ATTEMPTS;
      await ctx.db
        .update(outboxEvents)
        .set({
          status: exhausted ? 'FAILED' : 'PENDING',
          lastError: message.slice(0, 500),
          nextAttemptAt: new Date(Date.now() + nextAttemptDelayMs(attempts)),
        })
        .where(eq(outboxEvents.id, event.id));

      ctx.logger[exhausted ? 'error' : 'warn'](
        {
          event: 'outbox.publish_failed',
          outboxEventId: event.id,
          eventType: event.eventType,
          attempts,
          exhausted,
          err: message,
        },
        exhausted ? 'Outbox event exhausted its retries' : 'Outbox publish failed; will retry',
      );
    }
  }

  return { claimed: claimed.length, published, failed };
}

/** Fan one event out to realtime channels and push recipients. */
async function publishEvent(ctx: WorkerContext, event: OutboxEventRow): Promise<void> {
  const eventType = event.eventType as EventType;
  const audience = EVENT_AUDIENCE[eventType] ?? [];

  // 1. Realtime. Published to Redis pub/sub; the gateway relays to subscribers
  //    that passed authorization when they subscribed (plan §63).
  const realtimeChannels = await resolveChannels(ctx, event, audience);
  const message = JSON.stringify({
    id: event.id,
    type: event.eventType,
    aggregateId: event.aggregateId,
    aggregateVersion: event.aggregateVersion,
    occurredAt: event.createdAt.toISOString(),
    payload: event.payload,
  });

  for (const channel of realtimeChannels) {
    await ctx.redis.publish(channel, message);
  }

  // 2. Push notifications.
  const notifications = await buildNotifications(ctx, event, audience);

  /*
   * The order a push is about.
   *
   * It was `event.aggregateId`, which is the order only for order events: a
   * delivery event's aggregate is the *assignment*, so «المندوب وصل» carried an
   * assignment id as `orderId` and tapping it opened an order that does not
   * exist. The payload names the order for both kinds.
   */
  const payloadOrderId = (event.payload as Record<string, unknown>).orderId;
  const orderId = typeof payloadOrderId === 'string' ? payloadOrderId : event.aggregateId;

  for (const notification of notifications) {
    /*
     * Who it is for decides where a tap lands and how loud it is. A customer's
     * order update rides the `orders` channel with the system sound; a shop's
     * new order and a courier's task ride `work` with the new-order chime, and
     * the app routes them to the owner board or the delivery screen rather
     * than to a customer order page.
     */
    const data = { orderId, eventType: event.eventType, audience: notification.audience };
    const work = notification.work ?? notification.audience !== 'customer';

    // The unique index on (event, recipient, channel) is what makes a retried
    // batch safe: the second insert collides instead of alerting twice.
    const inserted = await ctx.db
      .insert(notificationDeliveries)
      .values({
        id: uuidv7(),
        outboxEventId: event.id,
        recipientUserId: notification.userId,
        channel: 'PUSH',
        titleAr: notification.titleAr,
        bodyAr: notification.bodyAr,
        dataJson: data,
        status: 'PENDING',
      })
      .onConflictDoNothing()
      .returning({ id: notificationDeliveries.id });

    if (inserted.length === 0) continue;

    const devices = await ctx.db
      .select({ pushToken: userDevices.pushToken })
      .from(userDevices)
      .where(
        and(eq(userDevices.userId, notification.userId), sql`${userDevices.revokedAt} IS NULL`),
      );

    if (devices.length === 0) {
      await ctx.db
        .update(notificationDeliveries)
        .set({ status: 'SKIPPED', failureReason: 'NO_ACTIVE_DEVICE' })
        .where(eq(notificationDeliveries.id, inserted[0]!.id));
      continue;
    }

    const results = await ctx.push.sendMany(
      devices.map((device) => ({
        token: device.pushToken,
        titleAr: notification.titleAr,
        bodyAr: notification.bodyAr,
        data,
        channelId: work ? 'work' : 'orders',
        ...(work ? { sound: 'new-order.wav' } : {}),
      })),
    );

    // A provider reporting a permanently dead token means the app was
    // uninstalled; disable it rather than retrying forever (plan §56).
    for (const [index, result] of results.entries()) {
      if (result.tokenInvalid) {
        const token = devices[index]?.pushToken;
        if (token) {
          await ctx.db
            .update(userDevices)
            .set({ revokedAt: new Date(), revokedReason: 'PROVIDER_REPORTED_INVALID' })
            .where(eq(userDevices.pushToken, token));
        }
      }
    }

    /*
     * SENT means "the push service accepted it", not "a phone received it".
     *
     * Expo answers a send with a *ticket*, which says the message was queued —
     * delivery is reported separately, minutes later, by a receipt fetched
     * against the ticket id. So this column is an outbound record, not proof of
     * arrival, and it should not be read as one in support or in reporting.
     *
     * It was worse than imprecise before: the provider was a stub that returned
     * ok unconditionally, so SENT meant nothing at all.
     *
     * TODO: fetch Expo push receipts (`getPushNotificationReceiptsAsync`) on a
     * delayed job and reconcile this to DELIVERED / FAILED. That is a separate
     * piece of work — it needs the ticket ids persisted here first — and is
     * tracked as a follow-up rather than done inline.
     */
    await ctx.db
      .update(notificationDeliveries)
      .set({
        status: results.some((r) => r.ok) ? 'SENT' : 'FAILED',
        sentAt: new Date(),
      })
      .where(eq(notificationDeliveries.id, inserted[0]!.id));
  }
}

/** Which realtime channels an event belongs on. */
async function resolveChannels(
  ctx: WorkerContext,
  event: OutboxEventRow,
  audience: readonly string[],
): Promise<string[]> {
  const payload = event.payload as Record<string, unknown>;
  const list: string[] = [];

  if (audience.includes('restaurant') && typeof payload.restaurantId === 'string') {
    list.push(channels.restaurantOrders(payload.restaurantId));
    if (typeof payload.branchId === 'string') {
      list.push(channels.branchOrders(payload.branchId));
    }
  }
  if (audience.includes('customer')) {
    if (typeof payload.orderId === 'string') list.push(channels.customerOrder(payload.orderId));
    if (typeof payload.customerId === 'string') {
      list.push(channels.customerOrders(payload.customerId));
    }
  }
  if (audience.includes('driver') && typeof payload.driverId === 'string') {
    list.push(channels.driverTasks(payload.driverId));
  }
  if (audience.includes('admin')) {
    list.push(channels.adminOperations());
  }

  // An order.ready event tells whichever driver is already assigned.
  if (event.eventType === 'order.ready' && typeof payload.orderId === 'string') {
    const [assignment] = await ctx.db
      .select({ driverId: deliveryAssignments.driverId })
      .from(deliveryAssignments)
      .where(
        and(
          eq(deliveryAssignments.orderId, payload.orderId),
          inArray(deliveryAssignments.status, ['ASSIGNED', 'ACCEPTED']),
        ),
      )
      .limit(1);
    if (assignment) list.push(channels.driverTasks(assignment.driverId));
  }

  return [...new Set(list)];
}

interface PendingNotification {
  readonly userId: string;
  readonly titleAr: string;
  readonly bodyAr: string;
  /** Which app surface the push belongs to — see `publishEvent`. */
  readonly audience: 'customer' | 'restaurant' | 'driver';
  /**
   * Ring with the new-order chime on the `work` channel. Defaults to every
   * shop and courier push; news that is not a job to do opts out.
   */
  readonly work?: boolean;
}

/** Turn an event into the Arabic notifications its audience should receive. */
async function buildNotifications(
  ctx: WorkerContext,
  event: OutboxEventRow,
  audience: readonly string[],
): Promise<PendingNotification[]> {
  const payload = event.payload as Record<string, unknown>;
  const out: PendingNotification[] = [];
  const orderNumber = String(payload.publicOrderNumber ?? '');

  const customerTemplate = customerTemplateFor(event.eventType as EventType, orderNumber);
  if (customerTemplate && audience.includes('customer') && typeof payload.customerId === 'string') {
    out.push({ userId: payload.customerId, audience: 'customer', ...customerTemplate });
  }

  if (event.eventType === 'order.placed' && typeof payload.restaurantId === 'string') {
    const total = formatIqdArabic(iqd(Number(payload.customerTotalIqd ?? 0)));
    const template = NOTIFICATION_TEMPLATES.newOrderForRestaurant(orderNumber, total, {
      customerName: typeof payload.customerFirstName === 'string' ? payload.customerFirstName : '',
      itemCount: Number(payload.itemCount ?? 0),
      area: typeof payload.deliveryArea === 'string' ? payload.deliveryArea : '',
    });

    // Everyone who can act on a live order gets the alert.
    for (const userId of await orderDesk(ctx, payload.restaurantId)) {
      out.push({ userId, audience: 'restaurant', ...template });
    }
  }

  /*
   * A courier turned the order down. Until somebody picks another one the
   * order is packed and going nowhere, so the shop hears about it now rather
   * than when the customer phones to ask.
   */
  if (event.eventType === 'delivery.rejected' && typeof payload.restaurantId === 'string') {
    const template = NOTIFICATION_TEMPLATES.deliveryRejectedForRestaurant(orderNumber);
    for (const userId of await orderDesk(ctx, payload.restaurantId)) {
      out.push({ userId, audience: 'restaurant', ...template });
    }
  }

  /*
   * The order is packed: tell the courier already assigned to it. Couriers are
   * assigned while the order is still being prepared so they arrive as it is
   * ready, and this is the moment they were waiting for.
   */
  if (event.eventType === 'order.ready' && typeof payload.orderId === 'string') {
    const [assignment] = await ctx.db
      .select({ userId: drivers.userId, shopName: restaurants.displayName })
      .from(deliveryAssignments)
      .innerJoin(drivers, eq(drivers.id, deliveryAssignments.driverId))
      .innerJoin(restaurants, eq(restaurants.id, deliveryAssignments.restaurantId))
      .where(
        and(
          eq(deliveryAssignments.orderId, payload.orderId),
          inArray(deliveryAssignments.status, ['ASSIGNED', 'ACCEPTED']),
        ),
      )
      .limit(1);
    if (assignment) {
      out.push({
        userId: assignment.userId,
        audience: 'driver',
        ...NOTIFICATION_TEMPLATES.orderReadyForDriver(orderNumber, assignment.shopName),
      });
    }
  }

  if (event.eventType === 'delivery.assigned' && typeof payload.driverId === 'string') {
    const [driver] = await ctx.db
      .select({ userId: drivers.userId })
      .from(drivers)
      .where(eq(drivers.id, payload.driverId))
      .limit(1);
    if (driver) {
      out.push({
        userId: driver.userId,
        audience: 'driver',
        ...NOTIFICATION_TEMPLATES.newAssignmentForDriver(orderNumber),
      });
    }
  }

  /*
   * A shop was approved. Its owner applied from the app and has been looking at
   * «قيد المراجعة» since; this is the moment they can start stocking it. Good
   * news rather than a job waiting, so it rides the ordinary channel — the
   * new-order chime would send them looking for an order that does not exist.
   */
  if (event.eventType === 'restaurant.approved' && typeof payload.ownerUserId === 'string') {
    out.push({
      userId: payload.ownerUserId,
      audience: 'restaurant',
      work: false,
      ...NOTIFICATION_TEMPLATES.shopApproved(String(payload.displayName ?? '')),
    });
  }

  if (event.eventType === 'delivery.reassigned' && typeof payload.driverId === 'string') {
    const [driver] = await ctx.db
      .select({ userId: drivers.userId })
      .from(drivers)
      .where(eq(drivers.id, payload.driverId))
      .limit(1);
    if (driver) {
      out.push({
        userId: driver.userId,
        audience: 'driver',
        ...NOTIFICATION_TEMPLATES.assignmentCancelled(orderNumber),
      });
    }
  }

  return out;
}

/** The shop staff who act on live orders — everyone who should hear one arrive. */
async function orderDesk(ctx: WorkerContext, restaurantId: string): Promise<string[]> {
  const members = await ctx.db
    .select({ userId: restaurantMembers.userId })
    .from(restaurantMembers)
    .where(
      and(
        eq(restaurantMembers.restaurantId, restaurantId),
        eq(restaurantMembers.isActive, true),
        inArray(restaurantMembers.role, ['OWNER', 'MANAGER', 'CASHIER']),
      ),
    );
  return [...new Set(members.map((member) => member.userId))];
}

function customerTemplateFor(
  eventType: EventType,
  orderNumber: string,
): { titleAr: string; bodyAr: string } | null {
  switch (eventType) {
    case 'order.accepted':
      return NOTIFICATION_TEMPLATES.orderAccepted(orderNumber);
    case 'order.preparing':
      return NOTIFICATION_TEMPLATES.orderPreparing(orderNumber);
    case 'order.ready':
      return NOTIFICATION_TEMPLATES.orderReady(orderNumber);
    case 'order.out_for_delivery':
      return NOTIFICATION_TEMPLATES.orderOutForDelivery(orderNumber);
    case 'delivery.arrived':
      return NOTIFICATION_TEMPLATES.orderArrived(orderNumber);
    case 'order.delivered':
    case 'order.completed':
      return NOTIFICATION_TEMPLATES.orderDelivered(orderNumber);
    case 'order.rejected':
      return NOTIFICATION_TEMPLATES.orderRejected(orderNumber);
    case 'order.cancelled':
      return NOTIFICATION_TEMPLATES.orderCancelled(orderNumber);
    default:
      return null;
  }
}

export type { OrderEventPayload, DeliveryEventPayload };
