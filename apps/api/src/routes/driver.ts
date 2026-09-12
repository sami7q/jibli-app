import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  ACTIVE_DELIVERY_STATUSES,
  AppError,
  assertTransition,
  DELIVERY_TRANSITIONS,
  DRIVER_AVAILABILITIES,
  ERROR_CODES,
  EVENT_TYPES,
  success,
  type DeliveryAssignmentStatus,
} from '@jibli/contracts';
import { assertDriver, assertOwnsAssignment } from '@jibli/auth';
import { deliveryPinSchema, idempotencyKeySchema, uuidSchema } from '@jibli/validation';
import { buildNavigationLinks, computeCustody, enqueueOutboxEvent } from '@jibli/domain';
import { deliveryAssignments, driverCashEvents, drivers, orders, restaurants } from '@jibli/db';
import type { AppContext } from '../lib/context.js';
import { requirePrincipal } from '../plugins/auth.js';
import { confirmDelivery } from '../services/delivery-service.js';

/**
 * Driver Mode API (plan §47, §49, §71).
 *
 * "Every endpoint verifies the active assignment belongs to the authenticated
 * driver. A driver who was removed or reassigned cannot continue using a
 * previously opened screen to mutate the task."
 */

const availabilitySchema = z.object({
  availability: z.enum(DRIVER_AVAILABILITIES),
});

const assignmentParamsSchema = z.object({ assignmentId: uuidSchema });

const rejectSchema = z.object({ reason: z.string().min(3).max(200) });

const confirmDeliverySchema = z.object({
  delivery_pin: deliveryPinSchema.optional(),
  /** Manager/support override, heavily audited (plan §52). */
  override_reason: z.string().min(10).max(300).optional(),
});

export function registerDriverRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Driver home: status, availability and cash summary (plan §47). */
  app.get('/api/v1/driver/me', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const driverId = assertDriver(principal);

    const [driver] = await ctx.db
      .select()
      .from(drivers)
      .where(eq(drivers.id, driverId))
      .limit(1);

    if (!driver) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'driver' } });

    const [activeAssignment] = await ctx.db
      .select({ id: deliveryAssignments.id, status: deliveryAssignments.status })
      .from(deliveryAssignments)
      .where(
        and(
          eq(deliveryAssignments.driverId, driverId),
          inArray(deliveryAssignments.status, [...ACTIVE_DELIVERY_STATUSES]),
        ),
      )
      .limit(1);

    return reply.send(
      success(
        {
          driver_id: driver.id,
          status: driver.status,
          availability: driver.availability,
          vehicle_type: driver.defaultVehicleType,
          active_assignment_id: activeAssignment?.id ?? null,
          active_assignment_status: activeAssignment?.status ?? null,
        },
        { request_id: request.requestId },
      ),
    );
  });

  /** Availability toggle — `متاح لاستلام الطلبات` (plan §132). */
  app.patch(
    '/api/v1/driver/me/availability',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      const driverId = assertDriver(principal);
      const body = availabilitySchema.parse(request.body);

      await ctx.db
        .update(drivers)
        .set({
          availability: body.availability,
          lastHeartbeatAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(drivers.id, driverId));

      return reply.send(
        success({ availability: body.availability }, { request_id: request.requestId }),
      );
    },
  );

  /**
   * Presence heartbeat (plan §51).
   * Presence is not location tracking: no coordinates are accepted or stored.
   */
  app.post('/api/v1/driver/heartbeat', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const driverId = assertDriver(principal);

    await ctx.db
      .update(drivers)
      .set({ lastHeartbeatAt: new Date() })
      .where(eq(drivers.id, driverId));

    return reply.send(success({ ok: true }, { request_id: request.requestId }));
  });

  /** The driver's task list. */
  app.get('/api/v1/driver/deliveries', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const driverId = assertDriver(principal);
    const query = z
      .object({
        status: z.enum(['active', 'history']).default('active'),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(request.query);

    const statusFilter =
      query.status === 'active'
        ? inArray(deliveryAssignments.status, [...ACTIVE_DELIVERY_STATUSES])
        : inArray(deliveryAssignments.status, ['DELIVERED', 'CANCELLED', 'REJECTED', 'REASSIGNED']);

    const rows = await ctx.db
      .select({
        assignment: deliveryAssignments,
        publicOrderNumber: orders.publicOrderNumber,
        customerTotalIqd: orders.customerTotalIqd,
        paymentMethod: orders.paymentMethod,
        orderStatus: orders.status,
        addressSnapshot: orders.deliveryAddressSnapshotJson,
        restaurantSnapshot: orders.restaurantLocationSnapshotJson,
        customerName: orders.customerNameSnapshot,
        customerPhone: orders.customerPhoneSnapshot,
        restaurantName: restaurants.displayName,
      })
      .from(deliveryAssignments)
      .innerJoin(orders, eq(deliveryAssignments.orderId, orders.id))
      .innerJoin(restaurants, eq(deliveryAssignments.restaurantId, restaurants.id))
      .where(and(eq(deliveryAssignments.driverId, driverId), statusFilter))
      .orderBy(desc(deliveryAssignments.assignedAt))
      .limit(query.limit);

    return reply.send(
      success(
        rows.map((row) => {
          const address = row.addressSnapshot as Record<string, unknown>;
          const isActive = ACTIVE_DELIVERY_STATUSES.includes(
            row.assignment.status as DeliveryAssignmentStatus,
          );
          return {
            assignment_id: row.assignment.id,
            order_id: row.assignment.orderId,
            public_order_number: row.publicOrderNumber,
            status: row.assignment.status,
            order_status: row.orderStatus,
            restaurant_name: row.restaurantName,
            payment_method: row.paymentMethod,
            /** COD amount the driver must collect. */
            cash_to_collect_iqd: row.customerTotalIqd,
            assigned_at: row.assignment.assignedAt.toISOString(),
            // Precise customer details only while the task is live (plan §107).
            customer: isActive
              ? { name: row.customerName, phone: row.customerPhone }
              : { name: row.customerName.split(' ')[0] ?? '', phone: null },
            delivery_address: isActive ? address : { city_name_ar: address?.cityNameAr ?? null },
            restaurant_location: isActive ? row.restaurantSnapshot : null,
          };
        }),
        { request_id: request.requestId },
      ),
    );
  });

  /** One assignment, with its navigation links (plan §50). */
  app.get(
    '/api/v1/driver/deliveries/:assignmentId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      const { assignmentId } = assignmentParamsSchema.parse(request.params);

      const [row] = await ctx.db
        .select({
          assignment: deliveryAssignments,
          publicOrderNumber: orders.publicOrderNumber,
          customerTotalIqd: orders.customerTotalIqd,
          customerName: orders.customerNameSnapshot,
          customerPhone: orders.customerPhoneSnapshot,
          addressSnapshot: orders.deliveryAddressSnapshotJson,
          restaurantSnapshot: orders.restaurantLocationSnapshotJson,
          customerNotes: orders.customerNotes,
        })
        .from(deliveryAssignments)
        .innerJoin(orders, eq(deliveryAssignments.orderId, orders.id))
        .where(eq(deliveryAssignments.id, assignmentId))
        .limit(1);

      if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'assignment' } });
      assertOwnsAssignment(principal, row.assignment.driverId);

      const address = row.addressSnapshot as Record<string, unknown>;
      const restaurant = row.restaurantSnapshot as Record<string, unknown>;

      const addressText = [address.districtText, address.street, address.building, address.landmark]
        .filter(Boolean)
        .join(' - ');

      return reply.send(
        success(
          {
            assignment_id: row.assignment.id,
            order_id: row.assignment.orderId,
            public_order_number: row.publicOrderNumber,
            status: row.assignment.status,
            cash_to_collect_iqd: row.customerTotalIqd,
            customer: { name: row.customerName, phone: row.customerPhone },
            customer_notes: row.customerNotes,
            delivery_address: address,
            // No token, PIN or secret ever goes into an external link (plan §50).
            navigation: buildNavigationLinks({
              latitude: address.latitude as number | null,
              longitude: address.longitude as number | null,
              addressText,
            }),
            restaurant_navigation: buildNavigationLinks({
              latitude: restaurant.latitude as number | null,
              longitude: restaurant.longitude as number | null,
              addressText: restaurant.addressText as string | null,
            }),
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /** Accept, reject, pickup and arrival all share one transition path. */
  const transitionRoute = (
    path: string,
    toStatus: DeliveryAssignmentStatus,
    eventType: (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES],
    options: { requiresReason?: boolean; orderPatch?: boolean } = {},
  ) => {
    app.post(`/api/v1/driver/deliveries/:assignmentId${path}`, { preHandler: app.authenticate }, async (request, reply) => {
      const principal = requirePrincipal(request);
      const { assignmentId } = assignmentParamsSchema.parse(request.params);
      const reason = options.requiresReason
        ? rejectSchema.parse(request.body).reason
        : null;

      await ctx.db.transaction(async (tx) => {
        const [assignment] = await tx
          .select()
          .from(deliveryAssignments)
          .where(eq(deliveryAssignments.id, assignmentId))
          .for('update')
          .limit(1);

        if (!assignment) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'assignment' } });
        }
        // A reassigned driver loses rights immediately (plan §49).
        assertOwnsAssignment(principal, assignment.driverId);

        assertTransition(
          DELIVERY_TRANSITIONS,
          { from: assignment.status, to: toStatus, actorType: 'DRIVER', reason },
          ERROR_CODES.DELIVERY_CANNOT_TRANSITION,
        );

        const now = new Date();
        const timestampPatch: Record<string, Date | string | null> = {};
        if (toStatus === 'ACCEPTED') timestampPatch.acceptedAt = now;
        if (toStatus === 'PICKED_UP') timestampPatch.pickedUpAt = now;
        if (toStatus === 'ARRIVED_CUSTOMER') timestampPatch.arrivedCustomerAt = now;
        if (toStatus === 'REJECTED') {
          timestampPatch.rejectionReason = reason;
          timestampPatch.cancelledAt = now;
        }

        await tx
          .update(deliveryAssignments)
          .set({
            status: toStatus,
            version: sql`${deliveryAssignments.version} + 1`,
            updatedAt: now,
            ...timestampPatch,
          })
          .where(eq(deliveryAssignments.id, assignmentId));

        // Pickup is what moves the order to OUT_FOR_DELIVERY — assignment alone
        // leaves it READY (plan §49).
        if (toStatus === 'PICKED_UP') {
          await tx
            .update(orders)
            .set({
              status: 'OUT_FOR_DELIVERY',
              outForDeliveryAt: now,
              version: sql`${orders.version} + 1`,
              updatedAt: now,
            })
            .where(eq(orders.id, assignment.orderId));
        }

        // The driver frees up again when they decline.
        if (toStatus === 'REJECTED') {
          await tx
            .update(drivers)
            .set({ availability: 'AVAILABLE', updatedAt: now })
            .where(eq(drivers.id, assignment.driverId));
        } else if (toStatus === 'ACCEPTED') {
          await tx
            .update(drivers)
            .set({ availability: 'ON_DELIVERY', updatedAt: now })
            .where(eq(drivers.id, assignment.driverId));
        }

        await enqueueOutboxEvent(tx, {
          eventType,
          aggregateType: 'delivery',
          aggregateId: assignmentId,
          aggregateVersion: assignment.version + 1,
          requestId: request.requestId,
          payload: {
            assignmentId,
            orderId: assignment.orderId,
            restaurantId: assignment.restaurantId,
            branchId: assignment.branchId,
            driverId: assignment.driverId,
            status: toStatus,
            reason,
          },
        });
      });

      return reply.send(success({ status: toStatus }, { request_id: request.requestId }));
    });
  };

  transitionRoute('/accept', 'ACCEPTED', EVENT_TYPES.DELIVERY_ACCEPTED);
  transitionRoute('/reject', 'REJECTED', EVENT_TYPES.DELIVERY_REJECTED, { requiresReason: true });
  transitionRoute('/pickup', 'PICKED_UP', EVENT_TYPES.DELIVERY_PICKED_UP);
  transitionRoute('/arrived-customer', 'ARRIVED_CUSTOMER', EVENT_TYPES.DELIVERY_ARRIVED);

  /**
   * COD completion (plan §53).
   *
   * Idempotent: a duplicate retry returns the original result and cannot
   * double-accrue commission or driver cash.
   */
  app.post(
    '/api/v1/driver/deliveries/:assignmentId/confirm-delivery',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      const { assignmentId } = assignmentParamsSchema.parse(request.params);
      const body = confirmDeliverySchema.parse(request.body ?? {});
      const idempotencyKey = idempotencyKeySchema.parse(
        request.headers['x-idempotency-key'] ?? `confirm-${assignmentId}`,
      );

      const result = await confirmDelivery(ctx, {
        assignmentId,
        principal,
        deliveryPin: body.delivery_pin ?? null,
        overrideReason: body.override_reason ?? null,
        idempotencyKey,
        requestId: request.requestId,
      });

      return reply.send(
        success(
          {
            order_id: result.orderId,
            status: result.orderStatus,
            payment_status: result.paymentStatus,
            cash_collected_iqd: result.cashCollectedIqd,
            replayed: result.replayed,
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /** Driver cash custody summary (plan §54). */
  app.get('/api/v1/driver/cash', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const driverId = assertDriver(principal);

    const events = await ctx.db
      .select({
        type: driverCashEvents.type,
        amountIqd: driverCashEvents.amountIqd,
        createdAt: driverCashEvents.createdAt,
      })
      .from(driverCashEvents)
      .where(eq(driverCashEvents.driverId, driverId))
      .orderBy(desc(driverCashEvents.createdAt))
      .limit(500);

    const custody = computeCustody(events);

    return reply.send(
      success(
        {
          collected_iqd: custody.collectedIqd,
          handed_over_iqd: custody.handedOverIqd,
          adjustments_iqd: custody.adjustmentsIqd,
          current_custody_iqd: custody.currentCustodyIqd,
        },
        { request_id: request.requestId },
      ),
    );
  });

  /** Register a push token (plan §56). */
}
