import { and, count, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  AppError,
  ERROR_CODES,
  EVENT_TYPES,
  LIVE_ORDER_STATUSES,
  ORDER_STATUSES,
  success,
} from '@jibli/contracts';
import { assertAdminPermission } from '@jibli/auth';
import { maskPhone, reasonSchema, uuidSchema } from '@jibli/validation';
import { AUDIT_ACTIONS, writeAudit } from '@jibli/domain';
import {
  cities,
  deliveryAssignments,
  drivers,
  orderItems,
  orderStatusHistory,
  orders,
  restaurantBranches,
  restaurants,
  users,
} from '@jibli/db';
import { clientIp, userAgent, type AppContext } from '../../lib/context.js';
import { requirePrincipal } from '../../plugins/auth.js';
import { transitionOrder } from '../../services/order-service.js';

/**
 * Global order oversight (plan §70, §87, §231).
 *
 * Admin sees orders across every restaurant, which is exactly why customer
 * phone numbers are masked by default here: a Support Agent investigating a
 * complaint does not need every customer's number, and plan §84 says support
 * roles "can see masked phone values by default, with controlled unmask
 * permission if operationally required".
 */

const listQuerySchema = z.object({
  q: z.string().max(80).optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  scope: z.enum(['all', 'live', 'cancelled']).default('all'),
  restaurant_id: uuidSchema.optional(),
  city_id: uuidSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export function registerAdminOrderRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/v1/admin/orders', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    assertAdminPermission(principal, 'order.read.global');
    const query = listQuerySchema.parse(request.query);

    // Only a role holding customer.phone.unmask sees real numbers (plan §84).
    const canUnmask = principal.platformRoles.some((role) =>
      ['SUPER_ADMIN', 'OPERATIONS_ADMIN'].includes(role),
    );

    const conditions = [];
    if (query.scope === 'live') {
      conditions.push(inArray(orders.status, [...LIVE_ORDER_STATUSES]));
    } else if (query.scope === 'cancelled') {
      conditions.push(inArray(orders.status, ['CANCELLED', 'REJECTED']));
    }
    if (query.status) conditions.push(eq(orders.status, query.status));
    if (query.restaurant_id) conditions.push(eq(orders.restaurantId, query.restaurant_id));
    if (query.city_id) conditions.push(eq(restaurantBranches.cityId, query.city_id));
    if (query.from) conditions.push(gte(orders.placedAt, new Date(query.from)));
    if (query.to) conditions.push(lte(orders.placedAt, new Date(query.to)));
    if (query.q) {
      conditions.push(
        or(
          ilike(orders.publicOrderNumber, `%${query.q}%`),
          ilike(orders.customerNameSnapshot, `%${query.q}%`),
        ) as never,
      );
    }

    const rows = await ctx.db
      .select({
        id: orders.id,
        publicOrderNumber: orders.publicOrderNumber,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        customerTotalIqd: orders.customerTotalIqd,
        commissionAmountIqd: orders.commissionAmountIqd,
        placedAt: orders.placedAt,
        completedAt: orders.completedAt,
        customerName: orders.customerNameSnapshot,
        customerPhone: orders.customerPhoneSnapshot,
        restaurantName: restaurants.displayName,
        restaurantId: orders.restaurantId,
        cityNameAr: cities.nameAr,
        driverName: users.fullName,
      })
      .from(orders)
      .innerJoin(restaurants, eq(orders.restaurantId, restaurants.id))
      .innerJoin(restaurantBranches, eq(orders.branchId, restaurantBranches.id))
      .innerJoin(cities, eq(restaurantBranches.cityId, cities.id))
      .leftJoin(
        deliveryAssignments,
        and(
          eq(deliveryAssignments.orderId, orders.id),
          inArray(deliveryAssignments.status, [
            'ASSIGNED',
            'ACCEPTED',
            'PICKED_UP',
            'ARRIVED_CUSTOMER',
            'DELIVERED',
          ]),
        ),
      )
      .leftJoin(drivers, eq(deliveryAssignments.driverId, drivers.id))
      .leftJoin(users, eq(drivers.userId, users.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(orders.placedAt))
      .limit(query.limit)
      .offset(query.offset);

    const [total] = await ctx.db
      .select({ value: count() })
      .from(orders)
      .innerJoin(restaurantBranches, eq(orders.branchId, restaurantBranches.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    return reply.send(
      success(
        rows.map((row) => ({
          id: row.id,
          public_order_number: row.publicOrderNumber,
          status: row.status,
          payment_status: row.paymentStatus,
          customer_total_iqd: row.customerTotalIqd,
          commission_amount_iqd: row.commissionAmountIqd,
          placed_at: row.placedAt.toISOString(),
          completed_at: row.completedAt?.toISOString() ?? null,
          customer_name: row.customerName,
          customer_phone: canUnmask ? row.customerPhone : maskPhone(row.customerPhone),
          phone_masked: !canUnmask,
          restaurant_id: row.restaurantId,
          restaurant_name: row.restaurantName,
          city_name_ar: row.cityNameAr,
          driver_name: row.driverName,
        })),
        { request_id: request.requestId, total: total?.value ?? 0, page_size: query.limit },
      ),
    );
  });

  /** Full order detail with the operational timeline (plan §103). */
  app.get(
    '/api/v1/admin/orders/:orderId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'order.read.global');
      const { orderId } = z.object({ orderId: uuidSchema }).parse(request.params);

      const canUnmask = principal.platformRoles.some((role) =>
        ['SUPER_ADMIN', 'OPERATIONS_ADMIN'].includes(role),
      );

      const [order] = await ctx.db
        .select({
          order: orders,
          restaurantName: restaurants.displayName,
          cityNameAr: cities.nameAr,
        })
        .from(orders)
        .innerJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .innerJoin(restaurantBranches, eq(orders.branchId, restaurantBranches.id))
        .innerJoin(cities, eq(restaurantBranches.cityId, cities.id))
        .where(eq(orders.id, orderId))
        .limit(1);

      if (!order) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'order' } });

      const items = await ctx.db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

      // The full operational history, not the customer-facing subset (plan §103).
      const history = await ctx.db
        .select({
          fromStatus: orderStatusHistory.fromStatus,
          toStatus: orderStatusHistory.toStatus,
          actorType: orderStatusHistory.actorType,
          actorName: users.fullName,
          reason: orderStatusHistory.reason,
          createdAt: orderStatusHistory.createdAt,
        })
        .from(orderStatusHistory)
        .leftJoin(users, eq(orderStatusHistory.actorUserId, users.id))
        .where(eq(orderStatusHistory.orderId, orderId))
        .orderBy(orderStatusHistory.createdAt);

      // Every assignment, including rejected and reassigned ones — this is what
      // makes a delivery dispute investigable (plan §104).
      const assignments = await ctx.db
        .select({
          id: deliveryAssignments.id,
          status: deliveryAssignments.status,
          driverName: users.fullName,
          assignedAt: deliveryAssignments.assignedAt,
          acceptedAt: deliveryAssignments.acceptedAt,
          pickedUpAt: deliveryAssignments.pickedUpAt,
          deliveredAt: deliveryAssignments.deliveredAt,
          rejectionReason: deliveryAssignments.rejectionReason,
        })
        .from(deliveryAssignments)
        .innerJoin(drivers, eq(deliveryAssignments.driverId, drivers.id))
        .innerJoin(users, eq(drivers.userId, users.id))
        .where(eq(deliveryAssignments.orderId, orderId))
        .orderBy(desc(deliveryAssignments.assignedAt));

      return reply.send(
        success(
          {
            id: order.order.id,
            public_order_number: order.order.publicOrderNumber,
            status: order.order.status,
            payment_status: order.order.paymentStatus,
            restaurant_name: order.restaurantName,
            city_name_ar: order.cityNameAr,
            customer_name: order.order.customerNameSnapshot,
            customer_phone: canUnmask
              ? order.order.customerPhoneSnapshot
              : maskPhone(order.order.customerPhoneSnapshot),
            phone_masked: !canUnmask,
            items_subtotal_iqd: order.order.itemsSubtotalIqd,
            delivery_fee_iqd: order.order.deliveryFeeIqd,
            platform_service_fee_iqd: order.order.platformServiceFeeIqd,
            discount_total_iqd: order.order.discountTotalIqd,
            customer_total_iqd: order.order.customerTotalIqd,
            commission_base_iqd: order.order.commissionBaseIqd,
            commission_flat_iqd: order.order.commissionFlatIqdSnapshot,
            commission_amount_iqd: order.order.commissionAmountIqd,
            restaurant_net_iqd: order.order.restaurantNetSnapshotIqd,
            customer_notes: order.order.customerNotes,
            placed_at: order.order.placedAt.toISOString(),
            completed_at: order.order.completedAt?.toISOString() ?? null,
            cancellation_reason: order.order.cancellationReason,
            rejection_reason: order.order.rejectionReason,
            version: order.order.version,
            // The delivery address is shown to Admin for support purposes but is
            // never included in a list response.
            delivery_address: order.order.deliveryAddressSnapshotJson,
            items: items.map((item) => ({
              name_ar: item.nameArSnapshot,
              quantity: item.quantity,
              unit_price_iqd: item.unitPriceIqdSnapshot,
              line_total_iqd: item.lineTotalIqd,
              notes: item.notes,
            })),
            timeline: history.map((entry) => ({
              from_status: entry.fromStatus,
              to_status: entry.toStatus,
              actor_type: entry.actorType,
              actor_name: entry.actorName,
              reason: entry.reason,
              at: entry.createdAt.toISOString(),
            })),
            assignments: assignments.map((assignment) => ({
              id: assignment.id,
              status: assignment.status,
              driver_name: assignment.driverName,
              assigned_at: assignment.assignedAt.toISOString(),
              accepted_at: assignment.acceptedAt?.toISOString() ?? null,
              picked_up_at: assignment.pickedUpAt?.toISOString() ?? null,
              delivered_at: assignment.deliveredAt?.toISOString() ?? null,
              rejection_reason: assignment.rejectionReason,
            })),
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * Admin override of an order state (plan §70).
   *
   * "Admin uses dedicated override commands rather than raw state updates."
   * The transition table still applies — an override widens *who* may act, not
   * *which* transitions exist.
   */
  app.post(
    '/api/v1/admin/orders/:orderId/cancel',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'order.override');
      const { orderId } = z.object({ orderId: uuidSchema }).parse(request.params);
      const body = z.object({ reason: reasonSchema }).parse(request.body);

      await ctx.db.transaction(async (tx) => {
        await transitionOrder(tx, {
          orderId,
          toStatus: 'CANCELLED',
          actorType: 'ADMIN',
          actorUserId: principal.userId,
          reason: body.reason,
          requestId: request.requestId,
          eventType: EVENT_TYPES.ORDER_CANCELLED,
          patch: { cancellationReason: 'ADMIN_OVERRIDE' },
        });

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.ORDER_OVERRIDE,
          entityType: 'order',
          entityId: orderId,
          after: { status: 'CANCELLED' },
          reason: body.reason,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });
      });

      return reply.send(success({ cancelled: true }, { request_id: request.requestId }));
    },
  );

  /** Platform-wide operational KPIs (plan §129). */
  app.get(
    '/api/v1/admin/orders/stats',
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertAdminPermission(requirePrincipal(request), 'reports.read.global');
      const query = z
        .object({ days: z.coerce.number().int().min(1).max(90).default(1) })
        .parse(request.query);

      const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);

      const [totals] = await ctx.db
        .select({
          total: count(),
          completed: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} = 'COMPLETED')`,
          cancelled: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} IN ('CANCELLED','REJECTED'))`,
          live: sql<number>`COUNT(*) FILTER (WHERE ${inArray(orders.status, [...LIVE_ORDER_STATUSES])})`,
          gmv: sql<number>`COALESCE(SUM(${orders.customerTotalIqd}) FILTER (WHERE ${orders.status} = 'COMPLETED'), 0)`,
          commission: sql<number>`COALESCE(SUM(${orders.commissionAmountIqd}) FILTER (WHERE ${orders.status} = 'COMPLETED'), 0)`,
          serviceFees: sql<number>`COALESCE(SUM(${orders.platformServiceFeeIqd}) FILTER (WHERE ${orders.status} = 'COMPLETED'), 0)`,
        })
        .from(orders)
        .where(gte(orders.placedAt, since));

      const total = Number(totals?.total ?? 0);
      const completed = Number(totals?.completed ?? 0);
      const gmv = Number(totals?.gmv ?? 0);

      return reply.send(
        success(
          {
            orders_total: total,
            orders_completed: completed,
            orders_cancelled: Number(totals?.cancelled ?? 0),
            orders_live: Number(totals?.live ?? 0),
            // Integer division: IQD has no sub-unit.
            average_order_iqd: completed === 0 ? 0 : Math.round(gmv / completed),
            completion_rate: total === 0 ? 0 : Math.round((completed / total) * 1000) / 10,
            gmv_iqd: gmv,
            // Named precisely: accrued commission, not collected cash (plan §130).
            commission_accrued_iqd: Number(totals?.commission ?? 0),
            service_fee_revenue_iqd: Number(totals?.serviceFees ?? 0),
          },
          { request_id: request.requestId, days: query.days },
        ),
      );
    },
  );
}
