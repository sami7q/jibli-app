import { and, desc, eq, gte, isNotNull, lt, lte, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { ORDER_STATUSES, success, type OrderStatus } from '@jibli/contracts';
import { bpsPercent } from '@jibli/money';
import { assertRestaurantPermission } from '@jibli/auth';
import { maskPhone } from '@jibli/validation';
import {
  deliveryAssignments,
  drivers,
  orders,
  settlementLines,
  settlements,
  users,
} from '@jibli/db';
import type { AppContext } from '../../lib/context.js';
import { restaurantScope } from './scope.js';

/**
 * Order history and the running commission period (plan §30, §39, §42).
 *
 * The live board answers "what is happening now". These two answer "what
 * happened" and "what will the next statement cost me" — the second matters
 * because the plan requires commission to be visible *as it accrues*, not only
 * when a statement lands at the end of the period.
 */

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function registerRestaurantHistoryRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * Past orders.
   *
   * Keyset pagination on `placed_at`: an offset would skip or repeat rows as
   * new orders arrive during paging, and orders arrive constantly here.
   */
  app.get(
    '/api/v1/restaurant-portal/orders/history',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'order.read');

      const query = z
        .object({
          status: z.enum(ORDER_STATUSES).optional(),
          from: dateSchema.optional(),
          to: dateSchema.optional(),
          search: z.string().max(40).optional(),
          before: z.string().datetime().optional(),
          limit: z.coerce.number().int().min(1).max(50).default(25),
        })
        .parse(request.query);

      const conditions = [eq(orders.restaurantId, restaurantId)];

      if (query.status) {
        conditions.push(eq(orders.status, query.status));
      } else {
        // Without a status filter, "history" means orders that are done with —
        // anything still moving belongs on the live board.
        conditions.push(
          notInArray(orders.status, [
            'PLACED',
            'PENDING_RESTAURANT',
            'ACCEPTED',
            'PREPARING',
            'READY',
            'OUT_FOR_DELIVERY',
          ] satisfies OrderStatus[]),
        );
      }

      if (query.from) conditions.push(gte(orders.placedAt, new Date(`${query.from}T00:00:00Z`)));
      if (query.to) conditions.push(lte(orders.placedAt, new Date(`${query.to}T23:59:59Z`)));
      if (query.before) conditions.push(lt(orders.placedAt, new Date(query.before)));
      if (query.search) {
        // Matches the public order number only. Searching by customer phone
        // would turn this into a lookup tool for numbers staff have no order
        // in front of them for (plan §92).
        conditions.push(sql`${orders.publicOrderNumber} ILIKE ${`%${query.search}%`}`);
      }

      const rows = await ctx.db
        .select({
          id: orders.id,
          publicOrderNumber: orders.publicOrderNumber,
          status: orders.status,
          placedAt: orders.placedAt,
          completedAt: orders.completedAt,
          cancelledAt: orders.cancelledAt,
          customerName: orders.customerNameSnapshot,
          customerPhone: orders.customerPhoneSnapshot,
          itemsSubtotalIqd: orders.itemsSubtotalIqd,
          deliveryFeeIqd: orders.deliveryFeeIqd,
          discountTotalIqd: orders.discountTotalIqd,
          customerTotalIqd: orders.customerTotalIqd,
          commissionAmountIqd: orders.commissionAmountIqd,
          restaurantNetIqd: orders.restaurantNetSnapshotIqd,
          cancellationReason: orders.cancellationReason,
          rejectionReason: orders.rejectionReason,
          /*
           * A scalar subquery, not a join: an order that was reassigned has
           * several assignment rows, and joining them would emit the order
           * several times — quietly corrupting both the page size and the
           * keyset cursor. This takes the last driver who held it.
           */
          driverName: sql<string | null>`(
            SELECT ${users.fullName}
            FROM ${deliveryAssignments}
            JOIN ${drivers} ON ${drivers.id} = ${deliveryAssignments.driverId}
            JOIN ${users} ON ${users.id} = ${drivers.userId}
            WHERE ${deliveryAssignments.orderId} = ${orders.id}
            ORDER BY ${deliveryAssignments.createdAt} DESC
            LIMIT 1
          )`,
        })
        .from(orders)
        .where(and(...conditions))
        // Same column the keyset cursor uses, so paging is stable.
        .orderBy(desc(orders.placedAt))
        .limit(query.limit + 1);

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page.at(-1);

      return reply.send(
        success(
          page.map((row) => ({
            id: row.id,
            public_order_number: row.publicOrderNumber,
            status: row.status,
            placed_at: row.placedAt.toISOString(),
            completed_at: row.completedAt?.toISOString() ?? null,
            cancelled_at: row.cancelledAt?.toISOString() ?? null,
            customer_name: row.customerName,
            // Masked by default; the full number belongs to the live order the
            // driver is actually delivering (plan §92).
            customer_phone_masked: maskPhone(row.customerPhone),
            items_subtotal_iqd: row.itemsSubtotalIqd,
            delivery_fee_iqd: row.deliveryFeeIqd,
            discount_total_iqd: row.discountTotalIqd,
            customer_total_iqd: row.customerTotalIqd,
            commission_amount_iqd: row.commissionAmountIqd,
            restaurant_net_iqd: row.restaurantNetIqd,
            closing_reason: row.cancellationReason ?? row.rejectionReason,
            driver_name: row.driverName,
          })),
          {
            request_id: request.requestId,
            has_more: hasMore,
            next_before: hasMore ? (last?.placedAt.toISOString() ?? null) : null,
          },
        ),
      );
    },
  );

  /**
   * Commission accrued since the last issued statement (plan §39).
   *
   * "Unsettled" is defined by the absence of a settlement line, not by a date
   * window: a line is written exactly once per order (enforced by a unique
   * index on order_id), so an order either belongs to a statement or it does
   * not. Deriving it from dates instead would double-count an order that a
   * late-running statement picked up.
   */
  app.get(
    '/api/v1/restaurant-portal/finance/commissions/open',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'finance.read');

      const query = z
        .object({ limit: z.coerce.number().int().min(1).max(200).default(100) })
        .parse(request.query);

      const unsettled = and(
        eq(orders.restaurantId, restaurantId),
        eq(orders.status, 'COMPLETED'),
        isNotNull(orders.completedAt),
        sql`NOT EXISTS (
          SELECT 1 FROM ${settlementLines}
          WHERE ${settlementLines.orderId} = ${orders.id}
        )`,
      );

      const [totals] = await ctx.db
        .select({
          orderCount: sql<number>`COUNT(*)`,
          commissionTotal: sql<number>`COALESCE(SUM(${orders.commissionAmountIqd}), 0)`,
          baseTotal: sql<number>`COALESCE(SUM(${orders.commissionBaseIqd}), 0)`,
          salesTotal: sql<number>`COALESCE(SUM(${orders.customerTotalIqd}), 0)`,
          netTotal: sql<number>`COALESCE(SUM(${orders.restaurantNetSnapshotIqd}), 0)`,
          firstCompletedAt: sql<Date | null>`MIN(${orders.completedAt})`,
          lastCompletedAt: sql<Date | null>`MAX(${orders.completedAt})`,
        })
        .from(orders)
        .where(unsettled);

      const rows = await ctx.db
        .select({
          id: orders.id,
          publicOrderNumber: orders.publicOrderNumber,
          completedAt: orders.completedAt,
          commissionBaseIqd: orders.commissionBaseIqd,
          rateBps: orders.commissionRateBpsSnapshot,
          commissionAmountIqd: orders.commissionAmountIqd,
          customerTotalIqd: orders.customerTotalIqd,
          deliveryFeeIqd: orders.deliveryFeeIqd,
          restaurantNetIqd: orders.restaurantNetSnapshotIqd,
        })
        .from(orders)
        .where(unsettled)
        .orderBy(desc(orders.completedAt))
        .limit(query.limit);

      // The next statement's period start, so the restaurant knows when the
      // running figure will be cut into a bill.
      const [nextPeriod] = await ctx.db
        .select({ policy: settlements.settlementPolicy, periodEnd: settlements.periodEnd })
        .from(settlements)
        .where(eq(settlements.restaurantId, restaurantId))
        .orderBy(desc(settlements.periodEnd))
        .limit(1);

      return reply.send(
        success(
          {
            order_count: Number(totals?.orderCount ?? 0),
            commission_total_iqd: Number(totals?.commissionTotal ?? 0),
            commission_base_total_iqd: Number(totals?.baseTotal ?? 0),
            gross_sales_iqd: Number(totals?.salesTotal ?? 0),
            restaurant_net_iqd: Number(totals?.netTotal ?? 0),
            first_completed_at: totals?.firstCompletedAt
              ? new Date(totals.firstCompletedAt).toISOString()
              : null,
            last_completed_at: totals?.lastCompletedAt
              ? new Date(totals.lastCompletedAt).toISOString()
              : null,
            last_settled_period_end: nextPeriod?.periodEnd?.toISOString() ?? null,
            policy: nextPeriod?.policy ?? null,
            truncated: Number(totals?.orderCount ?? 0) > rows.length,
            orders: rows.map((row) => ({
              id: row.id,
              public_order_number: row.publicOrderNumber,
              completed_at: row.completedAt?.toISOString() ?? null,
              commission_base_iqd: row.commissionBaseIqd,
              rate_bps: row.rateBps,
              rate_display: bpsPercent(row.rateBps),
              commission_amount_iqd: row.commissionAmountIqd,
              customer_total_iqd: row.customerTotalIqd,
              delivery_fee_iqd: row.deliveryFeeIqd,
              restaurant_net_iqd: row.restaurantNetIqd,
            })),
            note_ar:
              'هذا مبلغ تقديري لما سيظهر في الكشف القادم، ويشمل الطلبات المكتملة التي لم تُدرج بعد في أي كشف. المبلغ النهائي هو ما يصدر في الكشف.',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );
}
