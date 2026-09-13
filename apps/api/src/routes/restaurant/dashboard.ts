import { and, desc, eq, gt, gte, isNull, lt, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { success } from '@jibli/contracts';
import { assertRestaurantPermission } from '@jibli/auth';
import {
  addDays,
  businessDate,
  localDayOfWeek,
  periodFor,
  startOfBusinessDay,
  WEEKDAY_NAMES_AR,
} from '@jibli/domain';
import {
  inventoryItems,
  menuItems,
  orderItems,
  orders,
  restaurantCommissionConfigs,
} from '@jibli/db';
import type { AppContext } from '../../lib/context.js';
import { hasPermission, restaurantScope } from './scope.js';

/**
 * The restaurant home screen's data (plan §29, §30, §38, §131).
 *
 * Assembled in one endpoint rather than six, because the design puts all of it
 * above the fold: six round trips on a restaurant's tablet over a weak
 * connection would have the operator watching skeletons during a rush.
 *
 * **Business day, not UTC day.** Every "today" here is Asia/Baghdad midnight.
 * A UTC boundary would land at 03:00 local, so the dinner rush that runs past
 * midnight would be counted against the wrong day and the morning would open
 * showing yesterday's takings.
 */

/** Percentage change, guarding the division that makes it meaningless. */
function deltaPercent(current: number, previous: number): number | null {
  // Growth from nothing is not a percentage — the UI shows "جديد" instead.
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function registerRestaurantDashboardRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(
    '/api/v1/restaurant-portal/dashboard/overview',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'order.read');

      // Financial figures are a separate permission from the order board: a
      // Cashier sees the operational tiles and nothing about margin (plan §86).
      const canSeeFinance = hasPermission(() =>
        assertRestaurantPermission(principal, restaurantId, 'finance.read'),
      );
      const canSeeProfit = hasPermission(() =>
        assertRestaurantPermission(principal, restaurantId, 'profit.read'),
      );

      const now = new Date();
      const todayStart = startOfBusinessDay(now);
      const yesterdayStart = addDays(todayStart, -1);
      const weekStart = addDays(todayStart, -6);

      const completedBetween = (from: Date, to?: Date) =>
        and(
          eq(orders.restaurantId, restaurantId),
          eq(orders.status, 'COMPLETED'),
          gte(orders.completedAt, from),
          ...(to ? [lt(orders.completedAt, to)] : []),
        );

      /*
       * Today and yesterday come back as one row each rather than one grouped
       * query: the two windows are read independently by the delta maths, and
       * a GROUP BY that returns no row for an empty yesterday would have to be
       * back-filled anyway.
       */
      const [today] = await ctx.db
        .select({
          orderCount: sql<number>`COUNT(*)`,
          salesIqd: sql<number>`COALESCE(SUM(${orders.customerTotalIqd}), 0)`,
          commissionIqd: sql<number>`COALESCE(SUM(${orders.commissionAmountIqd}), 0)`,
          netIqd: sql<number>`COALESCE(SUM(${orders.restaurantNetSnapshotIqd}), 0)`,
        })
        .from(orders)
        .where(completedBetween(todayStart));

      const [yesterday] = await ctx.db
        .select({
          orderCount: sql<number>`COUNT(*)`,
          salesIqd: sql<number>`COALESCE(SUM(${orders.customerTotalIqd}), 0)`,
        })
        .from(orders)
        .where(completedBetween(yesterdayStart, todayStart));

      const [pending] = await ctx.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(orders)
        .where(
          and(eq(orders.restaurantId, restaurantId), eq(orders.status, 'PENDING_RESTAURANT')),
        );

      const [pendingYesterday] = await ctx.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(orders)
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            gte(orders.placedAt, yesterdayStart),
            lt(orders.placedAt, todayStart),
          ),
        );

      /*
       * Daily series for the last seven business days.
       *
       * Bucketed in SQL by the Baghdad calendar date so the boundaries match
       * every other figure on this screen; doing it in JavaScript would mean
       * re-deriving the same timezone rule in a second place.
       */
      const dailyRows = await ctx.db
        .select({
          day: sql<string>`to_char(${orders.completedAt} AT TIME ZONE 'Asia/Baghdad', 'YYYY-MM-DD')`,
          salesIqd: sql<number>`COALESCE(SUM(${orders.customerTotalIqd}), 0)`,
          orderCount: sql<number>`COUNT(*)`,
        })
        .from(orders)
        .where(completedBetween(weekStart))
        .groupBy(sql`1`)
        .orderBy(sql`1`);

      const salesByDay = new Map(
        dailyRows.map((row) => [row.day, { sales: Number(row.salesIqd), count: Number(row.orderCount) }]),
      );

      // Emit all seven days, including the quiet ones — a gap in a bar chart
      // reads as "no data recorded", not "no sales that day".
      const weeklySeries = Array.from({ length: 7 }, (_, index) => {
        /*
         * `dayStart` is the UTC instant of Baghdad midnight, which is 21:00 the
         * *previous* UTC day. Reading the date or weekday off it directly with
         * toISOString/getUTCDay names the wrong day and silently shifts the
         * whole chart by one — so both come from the zone-aware helpers, which
         * are also what the SQL bucket key matches.
         */
        const dayStart = addDays(weekStart, index);
        const key = businessDate(dayStart);
        const bucket = salesByDay.get(key);
        return {
          date: key,
          label_ar: WEEKDAY_NAMES_AR[localDayOfWeek(dayStart)] ?? key,
          sales_iqd: bucket?.sales ?? 0,
          order_count: bucket?.count ?? 0,
        };
      });

      /** Best sellers over the same seven days, by units sold. */
      const bestSellers = await ctx.db
        .select({
          menuItemId: orderItems.menuItemId,
          nameAr: sql<string>`MAX(${orderItems.nameArSnapshot})`,
          unitsSold: sql<number>`COALESCE(SUM(${orderItems.quantity}), 0)`,
          revenueIqd: sql<number>`COALESCE(SUM(${orderItems.lineTotalIqd}), 0)`,
        })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(completedBetween(weekStart))
        .groupBy(orderItems.menuItemId)
        .orderBy(desc(sql`COALESCE(SUM(${orderItems.quantity}), 0)`))
        .limit(5);

      /** Items at or below their low-stock threshold, most urgent first. */
      const lowStock = await ctx.db
        .select({
          id: inventoryItems.id,
          nameAr: inventoryItems.nameAr,
          onHand: inventoryItems.onHandQuantity,
          available: sql<string>`(${inventoryItems.onHandQuantity} - ${inventoryItems.reservedQuantity})`,
          threshold: inventoryItems.lowStockThreshold,
          unit: inventoryItems.unit,
        })
        .from(inventoryItems)
        .where(
          and(
            eq(inventoryItems.restaurantId, restaurantId),
            sql`${inventoryItems.lowStockThreshold} IS NOT NULL`,
            sql`(${inventoryItems.onHandQuantity} - ${inventoryItems.reservedQuantity}) <= ${inventoryItems.lowStockThreshold}`,
          ),
        )
        .orderBy(sql`(${inventoryItems.onHandQuantity} - ${inventoryItems.reservedQuantity})`)
        .limit(6);

      const [menuCount] = await ctx.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(menuItems)
        .where(and(eq(menuItems.restaurantId, restaurantId), eq(menuItems.isActive, true)));

      const todaySales = Number(today?.salesIqd ?? 0);
      const todayOrders = Number(today?.orderCount ?? 0);
      const yesterdaySales = Number(yesterday?.salesIqd ?? 0);
      const yesterdayOrders = Number(yesterday?.orderCount ?? 0);

      const finance = canSeeFinance
        ? await buildFinanceSummary(ctx, restaurantId, now, canSeeProfit)
        : null;

      return reply.send(
        success(
          {
            orders_today: todayOrders,
            orders_today_delta: deltaPercent(todayOrders, yesterdayOrders),
            sales_today_iqd: todaySales,
            sales_today_delta: deltaPercent(todaySales, yesterdaySales),
            // Integer division: IQD has no sub-unit, so an average is whole dinars.
            average_order_iqd: todayOrders === 0 ? 0 : Math.round(todaySales / todayOrders),
            average_order_delta: deltaPercent(
              todayOrders === 0 ? 0 : Math.round(todaySales / todayOrders),
              yesterdayOrders === 0 ? 0 : Math.round(yesterdaySales / yesterdayOrders),
            ),
            new_orders: Number(pending?.count ?? 0),
            new_orders_delta: deltaPercent(
              Number(pending?.count ?? 0),
              Number(pendingYesterday?.count ?? 0),
            ),
            active_menu_items: Number(menuCount?.count ?? 0),

            weekly_series: weeklySeries,
            weekly_total_iqd: weeklySeries.reduce((sum, day) => sum + day.sales_iqd, 0),

            best_sellers: bestSellers.map((row) => ({
              menu_item_id: row.menuItemId,
              name_ar: row.nameAr,
              units_sold: Number(row.unitsSold),
              revenue_iqd: Number(row.revenueIqd),
            })),

            low_stock: lowStock.map((row) => ({
              id: row.id,
              name_ar: row.nameAr,
              on_hand: row.onHand,
              // What the threshold was actually compared against.
              available: row.available,
              threshold: row.threshold,
              unit: row.unit,
            })),

            // Null when the role may not see money at all (plan §86).
            finance,
          },
          { request_id: request.requestId, business_day_start: todayStart.toISOString() },
        ),
      );
    },
  );
}

/**
 * Commission owed so far and when it falls due.
 *
 * The "estimated net" is exactly today's snapshot sum, not a recomputation:
 * every order already stores the net it was settled at, and recomputing from a
 * current rate would disagree with the statement (plan §24, §42).
 */
async function buildFinanceSummary(
  ctx: AppContext,
  restaurantId: string,
  now: Date,
  canSeeProfit: boolean,
) {
  /*
   * The commission is effective-dated, so "the current commission" is the
   * config whose window contains now — not a column on the restaurant. Reading
   * it any other way would show a fee that a future-dated change had already
   * replaced.
   */
  const [config] = await ctx.db
    .select({
      flatIqd: restaurantCommissionConfigs.commissionFlatIqd,
      policy: restaurantCommissionConfigs.settlementPolicy,
    })
    .from(restaurantCommissionConfigs)
    .where(
      and(
        eq(restaurantCommissionConfigs.restaurantId, restaurantId),
        lte(restaurantCommissionConfigs.effectiveFrom, now),
        or(
          isNull(restaurantCommissionConfigs.effectiveTo),
          gt(restaurantCommissionConfigs.effectiveTo, now),
        ),
      ),
    )
    .orderBy(desc(restaurantCommissionConfigs.effectiveFrom))
    .limit(1);

  const period = periodFor(now, config?.policy ?? 'HALF_MONTH');

  // Unsettled means "no settlement line exists", the same definition the
  // commissions screen uses, so the two never disagree.
  const [open] = await ctx.db
    .select({
      orderCount: sql<number>`COUNT(*)`,
      commissionIqd: sql<number>`COALESCE(SUM(${orders.commissionAmountIqd}), 0)`,
      netIqd: sql<number>`COALESCE(SUM(${orders.restaurantNetSnapshotIqd}), 0)`,
    })
    .from(orders)
    .where(
      and(
        eq(orders.restaurantId, restaurantId),
        eq(orders.status, 'COMPLETED'),
        sql`NOT EXISTS (
          SELECT 1 FROM settlement_lines
          WHERE settlement_lines.order_id = ${orders.id}
        )`,
      ),
    );

  const daysUntilClose = Math.max(
    0,
    Math.ceil((period.end.getTime() - now.getTime()) / 86_400_000),
  );

  return {
    open_commission_iqd: Number(open?.commissionIqd ?? 0),
    open_order_count: Number(open?.orderCount ?? 0),
    // Net is margin-adjacent, so it follows the profit permission.
    estimated_net_iqd: canSeeProfit ? Number(open?.netIqd ?? 0) : null,
    commission_flat_iqd: config?.flatIqd ?? null,
    period_label_ar: period.labelAr,
    period_end: period.end.toISOString(),
    days_until_settlement: daysUntilClose,
  };
}
