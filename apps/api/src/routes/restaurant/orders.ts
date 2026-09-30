import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  ACTIVE_DELIVERY_STATUSES,
  AppError,
  assertTransition,
  DELIVERY_TRANSITIONS,
  ERROR_CODES,
  EVENT_TYPES,
  LIVE_ORDER_STATUSES,
  ORDER_REJECTION_REASONS,
  success,
  type OrderStatus,
} from '@jibli/contracts';
import { assertRestaurantPermission } from '@jibli/auth';
import { uuidSchema } from '@jibli/validation';
import { enqueueOutboxEvent, isLowStock } from '@jibli/domain';
import {
  deliveryAssignments,
  drivers,
  inventoryItems,
  orderItemModifiers,
  orderItems,
  orders,
  restaurantDrivers,
  users,
  uuidv7,
} from '@jibli/db';
import type { AppContext } from '../../lib/context.js';
import { restaurantScope } from './scope.js';
import { transitionOrder } from '../../services/order-service.js';
import { releaseInventoryForOrder } from '../../services/inventory-service.js';

/**
 * Restaurant Portal API (plan §29, §32, §48, §70).
 *
 * Every handler resolves its restaurant scope from the authenticated session.
 * A submitted restaurant ID is checked against membership, never trusted
 * (plan §63).
 */

const orderParamsSchema = z.object({ orderId: uuidSchema });

const acceptSchema = z.object({
  expected_version: z.number().int().min(0).optional(),
  estimated_preparation_minutes: z.number().int().min(1).max(240).optional(),
});

const rejectSchema = z.object({
  reason: z.enum(ORDER_REJECTION_REASONS),
  note: z.string().max(300).optional(),
  expected_version: z.number().int().min(0).optional(),
});

const assignDriverSchema = z.object({
  driver_id: uuidSchema,
  expected_version: z.number().int().min(0).optional(),
});

/** Why the shop pulled an order back: read by dispatch, and by the courier. */
const unassignDriverSchema = z.object({ reason: z.string().trim().min(3).max(200) });

/**
 * When a courier may be given an order.
 *
 * From acceptance onward, not only once it is packed: a courier assigned while
 * the order is being prepared arrives as it becomes ready, which is how every
 * delivery counter runs. Before acceptance there is nothing to carry yet, and
 * after rejection or cancellation there never will be — the route accepted
 * both before, and a courier could be sent to collect an order the shop had
 * turned down.
 */
const ASSIGNABLE_ORDER_STATUSES: readonly OrderStatus[] = ['ACCEPTED', 'PREPARING', 'READY'];

export function registerRestaurantOrderRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * The live operations board (plan §29).
   *
   * Returns orders grouped by the Arabic lanes the design shows:
   * طلبات جديدة / قيد التحضير / جاهز / قيد التوصيل / مكتمل مؤخراً
   */
  app.get(
    '/api/v1/restaurant-portal/orders/live',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'order.read');

      const since = new Date(Date.now() - 4 * 60 * 60 * 1000);

      const rows = await ctx.db
        .select({
          order: orders,
          assignmentStatus: deliveryAssignments.status,
          driverName: users.fullName,
          driverPhone: users.phoneE164,
        })
        .from(orders)
        .leftJoin(
          deliveryAssignments,
          and(
            eq(deliveryAssignments.orderId, orders.id),
            inArray(deliveryAssignments.status, [...ACTIVE_DELIVERY_STATUSES]),
          ),
        )
        .leftJoin(drivers, eq(deliveryAssignments.driverId, drivers.id))
        .leftJoin(users, eq(drivers.userId, users.id))
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            or(inArray(orders.status, [...LIVE_ORDER_STATUSES]), gte(orders.completedAt, since)),
          ),
        )
        .orderBy(desc(orders.placedAt))
        .limit(200);

      const orderIds = rows.map((r) => r.order.id);
      const items =
        orderIds.length > 0
          ? await ctx.db.select().from(orderItems).where(inArray(orderItems.orderId, orderIds))
          : [];
      const itemIds = items.map((i) => i.id);
      const itemModifiers =
        itemIds.length > 0
          ? await ctx.db
              .select()
              .from(orderItemModifiers)
              .where(inArray(orderItemModifiers.orderItemId, itemIds))
          : [];

      const now = Date.now();

      return reply.send(
        success(
          rows.map((row) => ({
            id: row.order.id,
            public_order_number: row.order.publicOrderNumber,
            status: row.order.status,
            // Drives the SLA timer on the card (plan §29).
            age_minutes: Math.floor((now - row.order.placedAt.getTime()) / 60_000),
            placed_at: row.order.placedAt.toISOString(),
            customer_name: row.order.customerNameSnapshot,
            customer_phone: row.order.customerPhoneSnapshot,
            customer_notes: row.order.customerNotes,
            payment_method: row.order.paymentMethod,
            payment_status: row.order.paymentStatus,
            items_subtotal_iqd: row.order.itemsSubtotalIqd,
            delivery_fee_iqd: row.order.deliveryFeeIqd,
            customer_total_iqd: row.order.customerTotalIqd,
            // Commission is visible to the restaurant: it is their cost (plan §42).
            commission_amount_iqd: row.order.commissionAmountIqd,
            version: row.order.version,
            delivery_address: row.order.deliveryAddressSnapshotJson,
            // The shop's own estimate, set on acceptance: drives the «جاهز خلال» countdown.
            estimated_preparation_minutes: row.order.estimatedPreparationMinutes,
            accepted_at: row.order.acceptedAt ? row.order.acceptedAt.toISOString() : null,
            driver: row.driverName
              ? {
                  name: row.driverName,
                  phone: row.driverPhone,
                  assignment_status: row.assignmentStatus,
                }
              : null,
            items: items
              .filter((item) => item.orderId === row.order.id)
              .map((item) => ({
                id: item.id,
                name_ar: item.nameArSnapshot,
                quantity: item.quantity,
                unit_price_iqd: item.unitPriceIqdSnapshot,
                line_total_iqd: item.lineTotalIqd,
                notes: item.notes,
                modifiers: itemModifiers
                  .filter((m) => m.orderItemId === item.id)
                  .map((m) => ({ name_ar: m.nameArSnapshot, price_iqd: m.priceIqdSnapshot })),
              })),
          })),
          { request_id: request.requestId, restaurant_id: restaurantId },
        ),
      );
    },
  );

  /** Accept an order (plan §32). */
  app.post(
    '/api/v1/restaurant-portal/orders/:orderId/accept',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'order.accept');
      const { orderId } = orderParamsSchema.parse(request.params);
      const body = acceptSchema.parse(request.body ?? {});

      await ctx.db.transaction(async (tx) => {
        await assertOrderBelongsToRestaurant(tx, orderId, restaurantId);
        await transitionOrder(tx, {
          orderId,
          toStatus: 'ACCEPTED',
          actorType: 'RESTAURANT',
          actorUserId: principal.userId,
          expectedVersion: body.expected_version ?? null,
          requestId: request.requestId,
          eventType: EVENT_TYPES.ORDER_ACCEPTED,
          ...(body.estimated_preparation_minutes
            ? { patch: { estimatedPreparationMinutes: body.estimated_preparation_minutes } }
            : {}),
        });
      });

      return reply.send(success({ status: 'ACCEPTED' }, { request_id: request.requestId }));
    },
  );

  /**
   * Reject an order (plan §32).
   * A reason is mandatory and feeds restaurant-quality analytics.
   */
  app.post(
    '/api/v1/restaurant-portal/orders/:orderId/reject',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'order.reject');
      const { orderId } = orderParamsSchema.parse(request.params);
      const body = rejectSchema.parse(request.body);

      await ctx.db.transaction(async (tx) => {
        await assertOrderBelongsToRestaurant(tx, orderId, restaurantId);
        await transitionOrder(tx, {
          orderId,
          toStatus: 'REJECTED',
          actorType: 'RESTAURANT',
          actorUserId: principal.userId,
          reason: body.note ?? body.reason,
          expectedVersion: body.expected_version ?? null,
          requestId: request.requestId,
          eventType: EVENT_TYPES.ORDER_REJECTED,
          patch: { rejectionReason: body.reason },
        });

        // Rejection releases any stock the order was holding (plan §32).
        await releaseInventoryForOrder(tx, orderId);
      });

      return reply.send(success({ status: 'REJECTED' }, { request_id: request.requestId }));
    },
  );

  /** Kitchen transitions. */
  const kitchenRoute = (
    path: string,
    toStatus: OrderStatus,
    permission: 'order.prepare' | 'order.ready',
    eventType: (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES],
  ) => {
    app.post(
      `/api/v1/restaurant-portal/orders/:orderId${path}`,
      { preHandler: app.authenticate },
      async (request, reply) => {
        const { principal, restaurantId } = restaurantScope(request);
        assertRestaurantPermission(principal, restaurantId, permission);
        const { orderId } = orderParamsSchema.parse(request.params);
        const body = z
          .object({ expected_version: z.number().int().min(0).optional() })
          .parse(request.body ?? {});

        await ctx.db.transaction(async (tx) => {
          await assertOrderBelongsToRestaurant(tx, orderId, restaurantId);
          await transitionOrder(tx, {
            orderId,
            toStatus,
            actorType: 'RESTAURANT',
            actorUserId: principal.userId,
            expectedVersion: body.expected_version ?? null,
            requestId: request.requestId,
            eventType,
          });
        });

        return reply.send(success({ status: toStatus }, { request_id: request.requestId }));
      },
    );
  };

  kitchenRoute('/start-preparing', 'PREPARING', 'order.prepare', EVENT_TYPES.ORDER_PREPARING);
  kitchenRoute('/mark-ready', 'READY', 'order.ready', EVENT_TYPES.ORDER_READY);

  /** Drivers eligible for an assignment right now (plan §48). */
  app.get(
    '/api/v1/restaurant-portal/drivers/eligible',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'driver.assign');

      const rows = await ctx.db
        .select({
          driverId: drivers.id,
          name: users.fullName,
          phone: users.phoneE164,
          availability: drivers.availability,
          vehicleType: drivers.defaultVehicleType,
          canCollectCash: restaurantDrivers.canCollectCash,
          activeAssignments: sql<number>`(
            SELECT COUNT(*) FROM ${deliveryAssignments}
            WHERE ${deliveryAssignments.driverId} = ${drivers.id}
              AND ${inArray(deliveryAssignments.status, [...ACTIVE_DELIVERY_STATUSES])}
          )`,
        })
        .from(restaurantDrivers)
        .innerJoin(drivers, eq(restaurantDrivers.driverId, drivers.id))
        .innerJoin(users, eq(drivers.userId, users.id))
        .where(
          and(
            eq(restaurantDrivers.restaurantId, restaurantId),
            eq(restaurantDrivers.isActive, true),
            eq(drivers.status, 'ACTIVE'),
          ),
        );

      return reply.send(
        success(
          rows.map((row) => ({
            id: row.driverId,
            name: row.name,
            phone: row.phone,
            availability: row.availability,
            vehicle_type: row.vehicleType,
            can_collect_cash: row.canCollectCash,
            active_assignments: Number(row.activeAssignments),
            // Release 1 default is one active delivery per driver (plan §48).
            assignable: Number(row.activeAssignments) === 0 && row.availability !== 'OFFLINE',
          })),
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * Assign a driver (plan §48).
   *
   * "A driver shown as available in the UI may become busy milliseconds later."
   * The partial unique index on active assignments per driver is what actually
   * resolves the race; this handler translates that collision into a clear code.
   */
  app.post(
    '/api/v1/restaurant-portal/orders/:orderId/assign-driver',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'driver.assign');
      const { orderId } = orderParamsSchema.parse(request.params);
      const body = assignDriverSchema.parse(request.body);

      const assignmentId = await ctx.db.transaction(async (tx) => {
        const order = await assertOrderBelongsToRestaurant(tx, orderId, restaurantId);

        if (!ASSIGNABLE_ORDER_STATUSES.includes(order.status)) {
          throw new AppError(ERROR_CODES.ORDER_CANNOT_TRANSITION, {
            details: { reason: 'ORDER_NOT_ASSIGNABLE', orderStatus: order.status },
            messageAr: 'يمكن إسناد الطلب إلى مندوب بعد قبوله وحتى يصبح جاهزاً.',
          });
        }

        // The driver must belong to THIS restaurant (plan §182 test).
        const [membership] = await tx
          .select({
            driverId: restaurantDrivers.driverId,
            branchId: restaurantDrivers.branchId,
            isActive: restaurantDrivers.isActive,
            driverStatus: drivers.status,
            availability: drivers.availability,
          })
          .from(restaurantDrivers)
          .innerJoin(drivers, eq(restaurantDrivers.driverId, drivers.id))
          .where(
            and(
              eq(restaurantDrivers.restaurantId, restaurantId),
              eq(restaurantDrivers.driverId, body.driver_id),
            ),
          )
          .limit(1);

        if (!membership || !membership.isActive) {
          throw new AppError(ERROR_CODES.DRIVER_NOT_IN_RESTAURANT, {
            details: { driverId: body.driver_id },
          });
        }
        if (membership.driverStatus !== 'ACTIVE') {
          throw new AppError(ERROR_CODES.DRIVER_SUSPENDED, {
            details: { driverId: body.driver_id },
          });
        }

        const id = uuidv7();
        try {
          await tx.insert(deliveryAssignments).values({
            id,
            orderId,
            restaurantId,
            branchId: order.branchId,
            driverId: body.driver_id,
            status: 'ASSIGNED',
            assignedBy: principal.userId,
          });
        } catch (error) {
          // Unique violation: the driver already has a live task, or this order
          // already has one. Either way the UI must refresh (plan §113).
          if (
            typeof error === 'object' &&
            error !== null &&
            (error as { code?: string }).code === '23505'
          ) {
            throw new AppError(ERROR_CODES.DRIVER_AT_CAPACITY, {
              details: { driverId: body.driver_id },
            });
          }
          throw error;
        }

        await tx
          .update(drivers)
          .set({ availability: 'BUSY', updatedAt: new Date() })
          .where(eq(drivers.id, body.driver_id));

        await enqueueOutboxEvent(tx, {
          eventType: EVENT_TYPES.DELIVERY_ASSIGNED,
          aggregateType: 'delivery',
          aggregateId: id,
          requestId: request.requestId,
          payload: {
            assignmentId: id,
            orderId,
            publicOrderNumber: order.publicOrderNumber,
            restaurantId,
            branchId: order.branchId,
            driverId: body.driver_id,
            status: 'ASSIGNED',
          },
        });

        return id;
      });

      return reply
        .status(201)
        .send(success({ assignment_id: assignmentId }, { request_id: request.requestId }));
    },
  );

  /** Low-stock summary for the dashboard card (plan §129). */
  /**
   * Take an order back from its courier, so it can go to somebody else.
   *
   * The state machine has allowed the shop to reassign from ASSIGNED and
   * ACCEPTED since it was written; nothing exposed it. A courier who stopped
   * answering therefore held the order hostage — the unique index on live
   * assignments refused a second courier, and the only way out was Admin.
   *
   * Not once the order is collected: from PICKED_UP it is in the courier's
   * hands, and only Admin may unwind that.
   */
  app.post(
    '/api/v1/restaurant-portal/orders/:orderId/unassign-driver',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'driver.assign');
      const { orderId } = orderParamsSchema.parse(request.params);
      const body = unassignDriverSchema.parse(request.body ?? {});

      await ctx.db.transaction(async (tx) => {
        const order = await assertOrderBelongsToRestaurant(tx, orderId, restaurantId);

        const [assignment] = await tx
          .select()
          .from(deliveryAssignments)
          .where(
            and(
              eq(deliveryAssignments.orderId, orderId),
              inArray(deliveryAssignments.status, ['ASSIGNED', 'ACCEPTED']),
            ),
          )
          .for('update')
          .limit(1);

        if (!assignment) {
          throw new AppError(ERROR_CODES.DELIVERY_CANNOT_TRANSITION, {
            details: { reason: 'NO_RECALLABLE_ASSIGNMENT' },
            messageAr: 'لا يوجد مندوب يمكن سحب الطلب منه — ربما استلمه بالفعل.',
          });
        }

        assertTransition(
          DELIVERY_TRANSITIONS,
          {
            from: assignment.status,
            to: 'REASSIGNED',
            actorType: 'RESTAURANT',
            reason: body.reason,
          },
          ERROR_CODES.DELIVERY_CANNOT_TRANSITION,
        );

        const now = new Date();

        await tx
          .update(deliveryAssignments)
          .set({
            status: 'REASSIGNED',
            cancelledAt: now,
            cancellationReason: body.reason,
            version: sql`${deliveryAssignments.version} + 1`,
            updatedAt: now,
          })
          .where(eq(deliveryAssignments.id, assignment.id));

        // Free for the next order; one live task per courier (plan §48).
        await tx
          .update(drivers)
          .set({ availability: 'AVAILABLE', updatedAt: now })
          .where(eq(drivers.id, assignment.driverId));

        await enqueueOutboxEvent(tx, {
          eventType: EVENT_TYPES.DELIVERY_REASSIGNED,
          aggregateType: 'delivery',
          aggregateId: assignment.id,
          aggregateVersion: assignment.version + 1,
          requestId: request.requestId,
          payload: {
            assignmentId: assignment.id,
            orderId,
            publicOrderNumber: order.publicOrderNumber,
            restaurantId,
            branchId: order.branchId,
            driverId: assignment.driverId,
            status: 'REASSIGNED',
            reason: body.reason,
          },
        });
      });

      return reply.send(success({ unassigned: true }, { request_id: request.requestId }));
    },
  );

  app.get(
    '/api/v1/restaurant-portal/inventory/low-stock',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'inventory.read');

      const rows = await ctx.db
        .select()
        .from(inventoryItems)
        .where(
          and(
            eq(inventoryItems.restaurantId, restaurantId),
            eq(inventoryItems.isTracked, true),
            isNull(inventoryItems.deletedAt),
          ),
        );

      const low = rows
        .filter((row) =>
          isLowStock({
            onHand: row.onHandQuantity,
            reserved: row.reservedQuantity,
            allowNegativeStock: row.allowNegativeStock,
            lowStockThreshold: row.lowStockThreshold,
          }),
        )
        .map((row) => ({
          id: row.id,
          name_ar: row.nameAr,
          on_hand: row.onHandQuantity,
          reserved: row.reservedQuantity,
          threshold: row.lowStockThreshold,
          unit: row.unit,
        }));

      return reply.send(success(low, { request_id: request.requestId }));
    },
  );

  /** Today's headline numbers, matching the portal dashboard design. */
}

/**
 * Tenant guard for order-scoped commands.
 *
 * Reading the order and comparing its restaurant is what stops Restaurant A
 * accepting Restaurant B's order by guessing an ID (plan §63).
 */
async function assertOrderBelongsToRestaurant(
  tx: Parameters<Parameters<AppContext['db']['transaction']>[0]>[0],
  orderId: string,
  restaurantId: string,
) {
  const [order] = await tx
    .select({
      id: orders.id,
      restaurantId: orders.restaurantId,
      branchId: orders.branchId,
      publicOrderNumber: orders.publicOrderNumber,
      status: orders.status,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'order' } });
  if (order.restaurantId !== restaurantId) {
    throw new AppError(ERROR_CODES.TENANT_MISMATCH, { details: { orderId } });
  }
  return order;
}
