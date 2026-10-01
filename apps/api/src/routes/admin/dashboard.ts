import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { success, type OrderStatus } from '@jibli/contracts';
import { assertAdminPermission } from '@jibli/auth';
import { addDays, businessDate, startOfBusinessDay } from '@jibli/domain';
import {
  auditLogs,
  cities,
  governorates,
  orders,
  restaurantApplications,
  restaurantBranches,
  restaurants,
  users,
} from '@jibli/db';
import type { AppContext } from '../../lib/context.js';
import { requirePrincipal } from '../../plugins/auth.js';

/**
 * The Admin home screen's data (plan §129, §130).
 *
 * One endpoint for the whole screen: the design puts eleven panels above and
 * just below the fold, and eleven parallel requests would each pay the auth and
 * connection cost again for figures that are only meaningful together.
 *
 * Everything is a **business day** in Asia/Baghdad. A UTC day boundary falls at
 * 03:00 local, which would credit three hours of the night's orders to the
 * wrong day and make every "vs yesterday" comparison wrong twice over.
 */

/** Percentage change. Growth from zero is not a percentage, so it returns null. */
function deltaPercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Statuses that count as "in flight" for the live tile. */
const IN_FLIGHT: OrderStatus[] = [
  'PLACED',
  'PENDING_RESTAURANT',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
];

export function registerAdminDashboardRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(
    '/api/v1/admin/dashboard/overview',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      // The dashboard is a reporting surface, so it needs the reporting
      // permission — not merely "is staff" (plan §85).
      assertAdminPermission(principal, 'reports.read.global');

      const now = new Date();
      const todayStart = startOfBusinessDay(now);
      const yesterdayStart = addDays(todayStart, -1);
      const monthAgo = addDays(todayStart, -29);
      const weekAgo = addDays(todayStart, -6);
      const prevMonthStart = addDays(todayStart, -59);

      const completedBetween = (from: Date, to?: Date) =>
        and(
          eq(orders.status, 'COMPLETED'),
          gte(orders.completedAt, from),
          ...(to ? [lt(orders.completedAt, to)] : []),
        );

      // ── Headline tiles ────────────────────────────────────────────────────
      const [today] = await ctx.db
        .select({
          orderCount: sql<number>`COUNT(*)`,
          salesIqd: sql<number>`COALESCE(SUM(${orders.customerTotalIqd}), 0)`,
          commissionIqd: sql<number>`COALESCE(SUM(${orders.commissionAmountIqd}), 0)`,
        })
        .from(orders)
        .where(completedBetween(todayStart));

      const [yesterday] = await ctx.db
        .select({
          orderCount: sql<number>`COUNT(*)`,
          salesIqd: sql<number>`COALESCE(SUM(${orders.customerTotalIqd}), 0)`,
          commissionIqd: sql<number>`COALESCE(SUM(${orders.commissionAmountIqd}), 0)`,
        })
        .from(orders)
        .where(completedBetween(yesterdayStart, todayStart));

      const [restaurantCounts] = await ctx.db
        .select({
          active: sql<number>`COUNT(*) FILTER (WHERE ${restaurants.operationalStatus} = 'ACTIVE')`,
          addedThisMonth: sql<number>`COUNT(*) FILTER (WHERE ${gte(restaurants.createdAt, monthAgo)})`,
          addedPrevMonth: sql<number>`COUNT(*) FILTER (WHERE ${and(gte(restaurants.createdAt, prevMonthStart), lt(restaurants.createdAt, monthAgo))})`,
        })
        .from(restaurants)
        .where(isNull(restaurants.deletedAt));

      const [userCounts] = await ctx.db
        .select({
          active: sql<number>`COUNT(*) FILTER (WHERE ${users.status} = 'ACTIVE')`,
          joinedThisMonth: sql<number>`COUNT(*) FILTER (WHERE ${gte(users.createdAt, monthAgo)})`,
          joinedPrevMonth: sql<number>`COUNT(*) FILTER (WHERE ${and(gte(users.createdAt, prevMonthStart), lt(users.createdAt, monthAgo))})`,
        })
        .from(users)
        .where(isNull(users.deletedAt));

      // ── Order status split, today ─────────────────────────────────────────
      const statusRows = await ctx.db
        .select({ status: orders.status, count: sql<number>`COUNT(*)` })
        .from(orders)
        .where(gte(orders.placedAt, todayStart))
        .groupBy(orders.status);

      const byStatus = new Map(statusRows.map((row) => [row.status, Number(row.count)]));
      const sumOf = (statuses: OrderStatus[]) =>
        statuses.reduce((total, status) => total + (byStatus.get(status) ?? 0), 0);

      const statusDistribution = {
        completed: sumOf(['COMPLETED', 'DELIVERED']),
        delivering: sumOf(['OUT_FOR_DELIVERY']),
        preparing: sumOf(['PLACED', 'PENDING_RESTAURANT', 'ACCEPTED', 'PREPARING', 'READY']),
        cancelled: sumOf(['CANCELLED', 'REJECTED']),
      };
      const statusTotal =
        statusDistribution.completed +
        statusDistribution.delivering +
        statusDistribution.preparing +
        statusDistribution.cancelled;

      // ── Daily series: 30 days of sales, 7 days of commission ──────────────
      const dailyRows = await ctx.db
        .select({
          day: sql<string>`to_char(${orders.completedAt} AT TIME ZONE 'Asia/Baghdad', 'YYYY-MM-DD')`,
          salesIqd: sql<number>`COALESCE(SUM(${orders.customerTotalIqd}), 0)`,
          commissionIqd: sql<number>`COALESCE(SUM(${orders.commissionAmountIqd}), 0)`,
        })
        .from(orders)
        .where(completedBetween(monthAgo))
        .groupBy(sql`1`)
        .orderBy(sql`1`);

      const daily = new Map(
        dailyRows.map((row) => [
          row.day,
          { sales: Number(row.salesIqd), commission: Number(row.commissionIqd) },
        ]),
      );

      /*
       * Days with no orders still get a point. Skipping them would compress the
       * x-axis and draw a trend line that implies activity on dates that had
       * none.
       */
      const buildSeries = (from: Date, days: number, key: 'sales' | 'commission') =>
        Array.from({ length: days }, (_, index) => {
          const day = addDays(from, index);
          const date = businessDate(day);
          return { date, label: date.slice(5), value: daily.get(date)?.[key] ?? 0 };
        });

      // ── Platform performance ──────────────────────────────────────────────
      const [performance] = await ctx.db
        .select({
          averageOrderIqd: sql<number>`COALESCE(AVG(${orders.customerTotalIqd}), 0)`,
          averageDeliveryMinutes: sql<number>`COALESCE(AVG(
            EXTRACT(EPOCH FROM (${orders.completedAt} - ${orders.placedAt})) / 60
          ), 0)`,
        })
        .from(orders)
        .where(completedBetween(monthAgo));

      const [cancellation] = await ctx.db
        .select({
          total: sql<number>`COUNT(*)`,
          cancelled: sql<number>`COUNT(*) FILTER (WHERE ${orders.status} IN ('CANCELLED', 'REJECTED'))`,
        })
        .from(orders)
        .where(gte(orders.placedAt, monthAgo));

      // ── Leaderboards ──────────────────────────────────────────────────────
      const topRestaurants = await ctx.db
        .select({
          id: restaurants.id,
          name: restaurants.displayName,
          orderCount: sql<number>`COUNT(${orders.id})`,
          revenueIqd: sql<number>`COALESCE(SUM(${orders.customerTotalIqd}), 0)`,
        })
        .from(orders)
        .innerJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .where(completedBetween(monthAgo))
        .groupBy(restaurants.id, restaurants.displayName)
        .orderBy(desc(sql`COALESCE(SUM(${orders.customerTotalIqd}), 0)`))
        .limit(5);

      /*
       * There is no category table: a restaurant carries `cuisine_tags`, a JSON
       * array, so a restaurant tagged both "مشاوي" and "عراقي" counts toward
       * each. Unnesting in SQL is what makes that one-to-many correct; joining
       * a single "primary category" column would silently drop the others.
       */
      const topCategories = await ctx.db
        .select({
          nameAr: sql<string>`tag`,
          orderCount: sql<number>`COUNT(*)`,
        })
        .from(orders)
        .innerJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .innerJoin(
          sql`LATERAL jsonb_array_elements_text(${restaurants.cuisineTags}) AS tag`,
          sql`true`,
        )
        .where(completedBetween(monthAgo))
        .groupBy(sql`tag`)
        .orderBy(desc(sql`COUNT(*)`))
        .limit(5);

      // ── Feeds ─────────────────────────────────────────────────────────────
      const recentOrders = await ctx.db
        .select({
          id: orders.id,
          publicOrderNumber: orders.publicOrderNumber,
          restaurantName: restaurants.displayName,
          customerName: orders.customerNameSnapshot,
          totalIqd: orders.customerTotalIqd,
          status: orders.status,
          placedAt: orders.placedAt,
        })
        .from(orders)
        .innerJoin(restaurants, eq(orders.restaurantId, restaurants.id))
        .orderBy(desc(orders.placedAt))
        .limit(6);

      const pendingApplications = await ctx.db
        .select({
          id: restaurantApplications.id,
          displayName: restaurantApplications.displayName,
          cityNameAr: cities.nameAr,
          governorateNameAr: governorates.nameAr,
          submittedAt: restaurantApplications.createdAt,
        })
        .from(restaurantApplications)
        .innerJoin(cities, eq(restaurantApplications.cityId, cities.id))
        .innerJoin(governorates, eq(restaurantApplications.governorateId, governorates.id))
        .where(eq(restaurantApplications.status, 'UNDER_REVIEW'))
        .orderBy(desc(restaurantApplications.createdAt))
        .limit(5);

      /*
       * The activity feed reads the audit log, so it shows what was actually
       * recorded rather than a second, parallel notion of "recent events" that
       * could drift from the record auditors rely on (plan §89).
       */
      const activity = await ctx.db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          entityType: auditLogs.entityType,
          actorName: users.fullName,
          createdAt: auditLogs.createdAt,
        })
        .from(auditLogs)
        .leftJoin(users, eq(auditLogs.actorUserId, users.id))
        .orderBy(desc(auditLogs.createdAt))
        .limit(6);

      const [liveOrders] = await ctx.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(orders)
        .where(inArray(orders.status, IN_FLIGHT));

      const [openApplications] = await ctx.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(restaurantApplications)
        .where(inArray(restaurantApplications.status, ['UNDER_REVIEW', 'INFO_REQUESTED']));

      /*
       * Shops whose owner pressed «اطلب التفعيل» in the app and is waiting.
       * The request used to land only in a notification; a queue on the
       * home page is what makes it somebody's job.
       */
      const pendingActivations = await ctx.db
        .select({
          id: restaurants.id,
          displayName: restaurants.displayName,
          merchantType: restaurants.merchantType,
          requestedAt: restaurants.activationRequestedAt,
          note: restaurants.activationRequestNote,
          cityNameAr: cities.nameAr,
          governorateNameAr: governorates.nameAr,
        })
        .from(restaurants)
        .leftJoin(restaurantBranches, eq(restaurantBranches.restaurantId, restaurants.id))
        .leftJoin(cities, eq(restaurantBranches.cityId, cities.id))
        .leftJoin(governorates, eq(cities.governorateId, governorates.id))
        .where(and(isNotNull(restaurants.activationRequestedAt), isNull(restaurants.deletedAt)))
        .orderBy(asc(restaurants.activationRequestedAt))
        .limit(5);
      const [openActivations] = await ctx.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(restaurants)
        .where(and(isNotNull(restaurants.activationRequestedAt), isNull(restaurants.deletedAt)));

      const todaySales = Number(today?.salesIqd ?? 0);
      const todayOrders = Number(today?.orderCount ?? 0);
      const todayCommission = Number(today?.commissionIqd ?? 0);
      const cancelledTotal = Number(cancellation?.total ?? 0);

      return reply.send(
        success(
          {
            commission_today_iqd: todayCommission,
            commission_delta: deltaPercent(todayCommission, Number(yesterday?.commissionIqd ?? 0)),
            sales_today_iqd: todaySales,
            sales_delta: deltaPercent(todaySales, Number(yesterday?.salesIqd ?? 0)),
            orders_today: todayOrders,
            orders_delta: deltaPercent(todayOrders, Number(yesterday?.orderCount ?? 0)),
            active_users: Number(userCounts?.active ?? 0),
            users_delta: deltaPercent(
              Number(userCounts?.joinedThisMonth ?? 0),
              Number(userCounts?.joinedPrevMonth ?? 0),
            ),
            active_restaurants: Number(restaurantCounts?.active ?? 0),
            restaurants_delta: deltaPercent(
              Number(restaurantCounts?.addedThisMonth ?? 0),
              Number(restaurantCounts?.addedPrevMonth ?? 0),
            ),

            live_orders: Number(liveOrders?.count ?? 0),
            open_applications: Number(openApplications?.count ?? 0),
            open_activations: Number(openActivations?.count ?? 0),

            status_distribution: { ...statusDistribution, total: statusTotal },

            sales_series: buildSeries(monthAgo, 30, 'sales'),
            commission_series: buildSeries(weekAgo, 7, 'commission'),

            performance: {
              average_order_iqd: Math.round(Number(performance?.averageOrderIqd ?? 0)),
              average_delivery_minutes: Math.round(
                Number(performance?.averageDeliveryMinutes ?? 0),
              ),
              cancellation_rate_percent:
                cancelledTotal === 0
                  ? 0
                  : Math.round((Number(cancellation?.cancelled ?? 0) / cancelledTotal) * 1000) / 10,
            },

            top_restaurants: topRestaurants.map((row) => ({
              id: row.id,
              name: row.name,
              order_count: Number(row.orderCount),
              revenue_iqd: Number(row.revenueIqd),
            })),

            top_categories: topCategories.map((row) => ({
              name_ar: row.nameAr,
              order_count: Number(row.orderCount),
            })),

            recent_orders: recentOrders.map((row) => ({
              id: row.id,
              public_order_number: row.publicOrderNumber,
              restaurant_name: row.restaurantName,
              customer_name: row.customerName,
              total_iqd: row.totalIqd,
              status: row.status,
              placed_at: row.placedAt.toISOString(),
            })),

            pending_applications: pendingApplications.map((row) => ({
              id: row.id,
              display_name: row.displayName,
              city_name_ar: row.cityNameAr,
              governorate_name_ar: row.governorateNameAr,
              submitted_at: row.submittedAt.toISOString(),
            })),

            pending_activations: pendingActivations.map((row) => ({
              id: row.id,
              display_name: row.displayName,
              merchant_type: row.merchantType,
              city_name_ar: row.cityNameAr,
              governorate_name_ar: row.governorateNameAr,
              requested_at: row.requestedAt?.toISOString() ?? null,
              note: row.note,
            })),

            activity: activity.map((row) => ({
              id: row.id,
              action: row.action,
              entity_type: row.entityType,
              actor_name: row.actorName,
              created_at: row.createdAt.toISOString(),
            })),
          },
          { request_id: request.requestId, business_day_start: todayStart.toISOString() },
        ),
      );
    },
  );
}
