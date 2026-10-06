import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  AppError,
  ERROR_CODES,
  EVENT_TYPES,
  ORDER_CANCELLATION_REASONS,
  success,
} from '@jibli/contracts';
import { assertPhoneVerified, assertProfileComplete } from '@jibli/auth';
import { idempotencyKeySchema, quantitySchema, uuidSchema } from '@jibli/validation';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  IDEMPOTENCY_SCOPES,
} from '@jibli/domain';
import {
  deliveryAssignments,
  drivers,
  orderItemModifiers,
  orderItems,
  orders,
  orderStatusHistory,
  users,
} from '@jibli/db';
import type { AppContext } from '../lib/context.js';
import { requirePrincipal } from '../plugins/auth.js';
import { placeOrder, transitionOrder, type PlaceOrderResult } from '../services/order-service.js';
import { quoteOrder } from '../services/quote-service.js';

/**
 * Customer ordering routes (plan §70).
 *
 *   POST /api/v1/checkout/quote
 *   POST /api/v1/orders
 *   GET  /api/v1/orders
 *   GET  /api/v1/orders/{id}
 *   POST /api/v1/orders/{id}/cancel
 */

const lineSchema = z.object({
  menu_item_id: uuidSchema,
  quantity: quantitySchema,
  modifier_ids: z.array(uuidSchema).max(20).default([]),
  notes: z.string().max(200).optional(),
});

const quoteSchema = z.object({
  restaurant_id: uuidSchema,
  branch_id: uuidSchema,
  address_id: uuidSchema,
  lines: z.array(lineSchema).min(1).max(50),
});

const placeOrderSchema = quoteSchema.extend({
  customer_notes: z.string().max(300).optional(),
  /** What the client displayed. A mismatch raises PRICE_CHANGED (plan §112). */
  expected_total_iqd: z.number().int().min(0).optional(),
});

const cancelSchema = z.object({
  reason: z.enum(ORDER_CANCELLATION_REASONS).default('CUSTOMER_CHANGED_MIND'),
  note: z.string().max(300).optional(),
});

/**
 * Transitions worth telling a customer about.
 *
 * Everything an order does that they would notice, and nothing that is an
 * internal restatement of a step they have already been told about.
 */
const CUSTOMER_VISIBLE_STATUSES = [
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
] as const;

export function registerOrderRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * Authoritative quote (plan §22).
   *
   * Runs the same pricing path as PlaceOrder, so what the customer is shown and
   * what they are charged cannot drift apart.
   */
  app.post('/api/v1/checkout/quote', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    assertPhoneVerified(principal);
    assertProfileComplete(principal);
    const body = quoteSchema.parse(request.body);

    const quote = await quoteOrder(ctx, {
      userId: principal.userId,
      restaurantId: body.restaurant_id,
      branchId: body.branch_id,
      addressId: body.address_id,
      lines: body.lines.map((line) => ({
        menuItemId: line.menu_item_id,
        quantity: line.quantity,
        modifierIds: line.modifier_ids,
        notes: line.notes ?? null,
      })),
    });

    return reply.send(
      success(
        {
          items_subtotal_iqd: quote.totals.itemsSubtotalIqd,
          discount_total_iqd: quote.totals.discountTotalIqd,
          delivery_fee_iqd: quote.totals.deliveryFeeIqd,
          platform_service_fee_iqd: quote.totals.platformServiceFeeIqd,
          customer_total_iqd: quote.totals.customerTotalIqd,
          estimated_preparation_minutes: quote.estimatedPreparationMinutes,
          lines: quote.lines.map((line) => ({
            menu_item_id: line.menuItemId,
            name_ar: line.nameArSnapshot,
            unit_price_iqd: line.unitPriceIqdSnapshot,
            quantity: line.quantity,
            line_total_iqd: line.lineTotalIqd,
            modifiers: line.modifiers.map((m) => ({
              id: m.modifierId,
              name_ar: m.nameArSnapshot,
              price_iqd: m.priceIqdSnapshot,
            })),
          })),
          // Commission is a restaurant/platform concern; the customer never sees it.
        },
        { request_id: request.requestId },
      ),
    );
  });

  /**
   * Place an order (plan §27, §28).
   *
   * The idempotency key is mandatory: a mobile network timing out after the
   * server committed must not produce a second order when the app retries.
   */
  app.post('/api/v1/orders', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    assertPhoneVerified(principal);
    assertProfileComplete(principal);

    const body = placeOrderSchema.parse(request.body);
    const idempotencyKey = idempotencyKeySchema.parse(request.headers['x-idempotency-key'] ?? '');

    const claim = await claimIdempotencyKey<PlaceOrderResult>(ctx.db, {
      key: idempotencyKey,
      scope: IDEMPOTENCY_SCOPES.PLACE_ORDER,
      userId: principal.userId,
      requestBody: body,
    });

    if (claim.kind === 'REPLAYED') {
      // Return the original result, not a new order.
      return reply
        .status(200)
        .send(success(claim.response, { request_id: request.requestId, idempotent_replay: true }));
    }

    if (claim.kind === 'IN_PROGRESS') {
      // A concurrent attempt holds the key. Telling the client to retry is
      // correct: the winner will finish and the retry will replay its result.
      throw new AppError(ERROR_CODES.CONFLICT, {
        details: { reason: 'REQUEST_IN_PROGRESS', retryAfterSeconds: 2 },
      });
    }

    let result: PlaceOrderResult;
    try {
      result = await placeOrder(ctx, {
        userId: principal.userId,
        restaurantId: body.restaurant_id,
        branchId: body.branch_id,
        addressId: body.address_id,
        lines: body.lines.map((line) => ({
          menuItemId: line.menu_item_id,
          quantity: line.quantity,
          modifierIds: line.modifier_ids,
          notes: line.notes ?? null,
        })),
        customerNotes: body.customer_notes ?? null,
        expectedTotalIqd: body.expected_total_iqd ?? null,
        requestId: request.requestId,
      });
    } catch (error) {
      // Release the claim so a corrected retry can use the same key.
      await failIdempotencyKey(ctx.db, {
        key: idempotencyKey,
        scope: IDEMPOTENCY_SCOPES.PLACE_ORDER,
      });
      throw error;
    }

    const responseBody = {
      order_id: result.orderId,
      public_order_number: result.publicOrderNumber,
      status: result.status,
      customer_total_iqd: result.customerTotalIqd,
      estimated_preparation_minutes: result.estimatedPreparationMinutes,
      // The PIN is shown to the customer only, inside the app (plan §52).
      delivery_pin: result.deliveryPin,
    };

    await completeIdempotencyKey(ctx.db, {
      key: idempotencyKey,
      scope: IDEMPOTENCY_SCOPES.PLACE_ORDER,
      response: responseBody,
      resultEntityId: result.orderId,
    });

    return reply.status(201).send(success(responseBody, { request_id: request.requestId }));
  });

  /** Customer order history. */
  app.get('/api/v1/orders', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(50).default(20),
        offset: z.coerce.number().int().min(0).max(5000).default(0),
      })
      .parse(request.query);

    const rows = await ctx.db
      .select({
        id: orders.id,
        publicOrderNumber: orders.publicOrderNumber,
        status: orders.status,
        customerTotalIqd: orders.customerTotalIqd,
        placedAt: orders.placedAt,
        restaurantSnapshot: orders.restaurantLocationSnapshotJson,
      })
      .from(orders)
      .where(eq(orders.userId, principal.userId))
      .orderBy(desc(orders.placedAt))
      .limit(query.limit)
      .offset(query.offset);

    return reply.send(
      success(
        rows.map((row) => ({
          id: row.id,
          public_order_number: row.publicOrderNumber,
          status: row.status,
          customer_total_iqd: row.customerTotalIqd,
          placed_at: row.placedAt.toISOString(),
          restaurant_name:
            (row.restaurantSnapshot as Record<string, unknown> | null)?.displayName ?? null,
        })),
        { request_id: request.requestId, has_more: rows.length === query.limit },
      ),
    );
  });

  /**
   * The customer's notification feed.
   *
   * Built from `order_status_history`, which `transitionOrder` writes inside
   * the same transaction as the status change — not from
   * `notification_deliveries`, which the worker writes afterwards. The
   * difference matters: a feed sourced from the delivery table is empty
   * whenever the worker is down or not deployed, and a notification centre
   * that is sometimes empty for reasons the customer cannot see is worse than
   * none. This one is a view of what actually happened to their orders, so it
   * cannot disagree with the order screen and cannot go missing.
   *
   * Read state is not stored here. It is one timestamp per device, kept by the
   * app, which is the honest scope for a bell: reading a notification on a
   * phone says nothing about a tablet.
   */
  app.get('/api/v1/notifications', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(40) })
      .parse(request.query);

    const rows = await ctx.db
      .select({
        id: orderStatusHistory.id,
        orderId: orders.id,
        publicOrderNumber: orders.publicOrderNumber,
        status: orderStatusHistory.toStatus,
        at: orderStatusHistory.createdAt,
        restaurantSnapshot: orders.restaurantLocationSnapshotJson,
      })
      .from(orderStatusHistory)
      .innerJoin(orders, eq(orderStatusHistory.orderId, orders.id))
      .where(
        and(
          eq(orders.userId, principal.userId),
          /*
           * PENDING_RESTAURANT is the same moment as PLACED seen from the
           * kitchen's side, and a customer told twice that one order was sent
           * learns to distrust the bell.
           */
          inArray(orderStatusHistory.toStatus, [...CUSTOMER_VISIBLE_STATUSES]),
        ),
      )
      .orderBy(desc(orderStatusHistory.createdAt))
      .limit(query.limit);

    return reply.send(
      success(
        rows.map((row) => ({
          id: row.id,
          order_id: row.orderId,
          public_order_number: row.publicOrderNumber,
          status: row.status,
          restaurant_name:
            (row.restaurantSnapshot as Record<string, unknown> | null)?.displayName ?? null,
          at: row.at.toISOString(),
        })),
        { request_id: request.requestId },
      ),
    );
  });

  /** Order detail and tracking timeline (plan §55). */
  app.get('/api/v1/orders/:orderId', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const { orderId } = z.object({ orderId: uuidSchema }).parse(request.params);

    const [order] = await ctx.db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, principal.userId)))
      .limit(1);

    if (!order) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'order' } });

    const items = await ctx.db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const itemIds = items.map((i) => i.id);
    const itemModifiers =
      itemIds.length > 0
        ? await ctx.db
            .select()
            .from(orderItemModifiers)
            .where(inArray(orderItemModifiers.orderItemId, itemIds))
        : [];

    const history = await ctx.db
      .select({
        toStatus: orderStatusHistory.toStatus,
        createdAt: orderStatusHistory.createdAt,
      })
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId))
      .orderBy(orderStatusHistory.createdAt);

    // Driver contact appears only once assigned, and only first name + phone
    // (plan §55, §84).
    const [assignment] = await ctx.db
      .select({
        status: deliveryAssignments.status,
        driverId: deliveryAssignments.driverId,
        driverName: users.fullName,
        driverPhone: users.phoneE164,
        photoAssetId: drivers.photoAssetId,
      })
      .from(deliveryAssignments)
      .innerJoin(drivers, eq(deliveryAssignments.driverId, drivers.id))
      .innerJoin(users, eq(drivers.userId, users.id))
      .where(
        and(
          eq(deliveryAssignments.orderId, orderId),
          inArray(deliveryAssignments.status, [
            'ASSIGNED',
            'ACCEPTED',
            'PICKED_UP',
            'ARRIVED_CUSTOMER',
            'DELIVERED',
          ]),
        ),
      )
      .orderBy(desc(deliveryAssignments.assignedAt))
      .limit(1);

    return reply.send(
      success(
        {
          id: order.id,
          public_order_number: order.publicOrderNumber,
          status: order.status,
          payment_method: order.paymentMethod,
          payment_status: order.paymentStatus,
          items_subtotal_iqd: order.itemsSubtotalIqd,
          delivery_fee_iqd: order.deliveryFeeIqd,
          platform_service_fee_iqd: order.platformServiceFeeIqd,
          discount_total_iqd: order.discountTotalIqd,
          customer_total_iqd: order.customerTotalIqd,
          placed_at: order.placedAt.toISOString(),
          estimated_preparation_minutes: order.estimatedPreparationMinutes,
          customer_notes: order.customerNotes,
          restaurant: order.restaurantLocationSnapshotJson,
          delivery_address: order.deliveryAddressSnapshotJson,
          items: items.map((item) => ({
            id: item.id,
            name_ar: item.nameArSnapshot,
            unit_price_iqd: item.unitPriceIqdSnapshot,
            quantity: item.quantity,
            line_total_iqd: item.lineTotalIqd,
            notes: item.notes,
            modifiers: itemModifiers
              .filter((m) => m.orderItemId === item.id)
              .map((m) => ({ name_ar: m.nameArSnapshot, price_iqd: m.priceIqdSnapshot })),
          })),
          timeline: history.map((entry) => ({
            status: entry.toStatus,
            at: entry.createdAt.toISOString(),
          })),
          driver: assignment
            ? {
                first_name: (assignment.driverName ?? '').split(' ')[0] ?? '',
                phone: assignment.driverPhone,
                photo_asset_id: assignment.photoAssetId,
                status: assignment.status,
              }
            : null,
        },
        { request_id: request.requestId },
      ),
    );
  });

  /**
   * Customer cancellation (plan §180).
   *
   * Only permitted before the kitchen commits; the transition table enforces
   * exactly which statuses a CUSTOMER actor may cancel from.
   */
  app.post(
    '/api/v1/orders/:orderId/cancel',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      const { orderId } = z.object({ orderId: uuidSchema }).parse(request.params);
      const body = cancelSchema.parse(request.body ?? {});

      await ctx.db.transaction(async (tx) => {
        const [order] = await tx
          .select({ id: orders.id, userId: orders.userId })
          .from(orders)
          .where(eq(orders.id, orderId))
          .limit(1);

        if (!order) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'order' } });
        if (order.userId !== principal.userId) {
          // A customer must not learn about another customer's order.
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'order' } });
        }

        await transitionOrder(tx, {
          orderId,
          toStatus: 'CANCELLED',
          actorType: 'CUSTOMER',
          actorUserId: principal.userId,
          reason: body.note ?? body.reason,
          requestId: request.requestId,
          eventType: EVENT_TYPES.ORDER_CANCELLED,
          patch: { cancellationReason: body.reason },
        });
      });

      return reply.send(success({ cancelled: true }, { request_id: request.requestId }));
    },
  );
}
