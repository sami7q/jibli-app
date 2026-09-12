import { and, count, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  AppError,
  EXPENSE_CATEGORIES,
  ERROR_CODES,
  SETTLEMENT_STATUSES,
  success,
} from '@jibli/contracts';
import { assertRestaurantPermission } from '@jibli/auth';
import {
  idempotencyKeySchema,
  iqdAmountSchema,
  isoDateSchema,
  reasonSchema,
  uuidSchema,
} from '@jibli/validation';
import { bpsPercent } from '@jibli/money';
import { assertHandoverAllowed, claimIdempotencyKey, completeIdempotencyKey, computeCustody, failIdempotencyKey, IDEMPOTENCY_SCOPES, startOfBusinessDay } from '@jibli/domain';
import { driverCashEvents, driverCashHandovers, drivers, orderItems, orders, restaurantExpenses, settlementLines, settlementPayments, settlements, users, uuidv7 } from '@jibli/db';
import type { AppContext } from '../../lib/context.js';
import { restaurantScope } from './scope.js';

/**
 * Restaurant finance and management accounting (plan §38, §39, §42, §73).
 *
 * Two distinct ledgers meet here and must never be conflated:
 *
 *   - **Platform finance**: what the restaurant owes Jibli in commission.
 *   - **Restaurant management accounting**: the restaurant's own sales, cost of
 *     goods, expenses and estimated profit.
 *
 * Driver COD cash is a third thing again — restaurant money held by a driver,
 * not a Jibli balance (plan §54).
 */

export function registerRestaurantFinanceRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * Profit view (plan §38).
   *
   *   Net Sales − COGS = Gross Profit
   *   Gross Profit − Commission − Expenses = Estimated Operating Profit
   *
   * Labelled "estimated" throughout, because cost data is frequently
   * incomplete and the plan requires the UI to say so.
   */
  app.get(
    '/api/v1/restaurant-portal/finance/profit',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'profit.read');

      const query = z
        .object({ days: z.coerce.number().int().min(1).max(365).default(30) })
        .parse(request.query);

      const since = startOfBusinessDay(
        new Date(Date.now() - query.days * 24 * 60 * 60 * 1000),
        ctx.env.BUSINESS_TIMEZONE,
      );

      const [sales] = await ctx.db
        .select({
          orderCount: count(),
          netSales: sql<number>`COALESCE(SUM(${orders.commissionBaseIqd}), 0)`,
          commission: sql<number>`COALESCE(SUM(${orders.commissionAmountIqd}), 0)`,
          deliveryFees: sql<number>`COALESCE(SUM(${orders.deliveryFeeIqd}), 0)`,
        })
        .from(orders)
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            eq(orders.status, 'COMPLETED'),
            gte(orders.completedAt, since),
          ),
        );

      // Cost of goods from the per-line cost snapshots. Lines with no cost
      // recorded are counted separately so the UI can say the figure is partial.
      const [cogs] = await ctx.db
        .select({
          total: sql<number>`COALESCE(SUM(${orderItems.costPriceIqdSnapshot} * ${orderItems.quantity}), 0)`,
          linesWithCost: sql<number>`COUNT(*) FILTER (WHERE ${orderItems.costPriceIqdSnapshot} IS NOT NULL)`,
          totalLines: count(),
        })
        .from(orderItems)
        .innerJoin(orders, eq(orderItems.orderId, orders.id))
        .where(
          and(
            eq(orders.restaurantId, restaurantId),
            eq(orders.status, 'COMPLETED'),
            gte(orders.completedAt, since),
          ),
        );

      const [expenses] = await ctx.db
        .select({ total: sql<number>`COALESCE(SUM(${restaurantExpenses.amountIqd}), 0)` })
        .from(restaurantExpenses)
        .where(
          and(
            eq(restaurantExpenses.restaurantId, restaurantId),
            gte(restaurantExpenses.expenseDate, since.toISOString().slice(0, 10)),
          ),
        );

      const netSales = Number(sales?.netSales ?? 0);
      const commission = Number(sales?.commission ?? 0);
      const deliveryFees = Number(sales?.deliveryFees ?? 0);
      const costOfGoods = Number(cogs?.total ?? 0);
      const operatingExpenses = Number(expenses?.total ?? 0);

      const grossProfit = netSales - costOfGoods;
      const estimatedOperatingProfit = grossProfit - commission - operatingExpenses;

      const linesWithCost = Number(cogs?.linesWithCost ?? 0);
      const totalLines = Number(cogs?.totalLines ?? 0);
      const costCoverage = totalLines === 0 ? 0 : Math.round((linesWithCost / totalLines) * 100);

      return reply.send(
        success(
          {
            order_count: sales?.orderCount ?? 0,
            net_sales_iqd: netSales,
            delivery_fees_iqd: deliveryFees,
            cost_of_goods_iqd: costOfGoods,
            gross_profit_iqd: grossProfit,
            commission_iqd: commission,
            operating_expenses_iqd: operatingExpenses,
            estimated_operating_profit_iqd: estimatedOperatingProfit,
            // How much of the period actually has cost data behind it. Without
            // this the profit figure looks more precise than it is (plan §38).
            cost_data_coverage_percent: costCoverage,
            is_estimate: costCoverage < 100,
            note_ar:
              costCoverage < 100
                ? `الأرباح تقديرية: ${costCoverage}% فقط من الأصناف لها سعر تكلفة مسجّل. أضف أسعار التكلفة في المنيو لدقة أعلى.`
                : 'جميع الأصناف لها سعر تكلفة مسجّل.',
          },
          { request_id: request.requestId, days: query.days },
        ),
      );
    },
  );

  // ── Expenses (plan §38) ───────────────────────────────────────────────────

  app.get(
    '/api/v1/restaurant-portal/finance/expenses',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'expense.read');

      const query = z
        .object({
          category: z.enum(EXPENSE_CATEGORIES).optional(),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        })
        .parse(request.query);

      const conditions = [eq(restaurantExpenses.restaurantId, restaurantId)];
      if (query.category) conditions.push(eq(restaurantExpenses.category, query.category));

      const rows = await ctx.db
        .select({
          id: restaurantExpenses.id,
          category: restaurantExpenses.category,
          amountIqd: restaurantExpenses.amountIqd,
          descriptionAr: restaurantExpenses.descriptionAr,
          expenseDate: restaurantExpenses.expenseDate,
          createdBy: users.fullName,
          createdAt: restaurantExpenses.createdAt,
        })
        .from(restaurantExpenses)
        .leftJoin(users, eq(restaurantExpenses.createdBy, users.id))
        .where(and(...conditions))
        .orderBy(desc(restaurantExpenses.expenseDate))
        .limit(query.limit);

      const [totals] = await ctx.db
        .select({ total: sql<number>`COALESCE(SUM(${restaurantExpenses.amountIqd}), 0)` })
        .from(restaurantExpenses)
        .where(and(...conditions));

      return reply.send(
        success(
          rows.map((row) => ({
            id: row.id,
            category: row.category,
            amount_iqd: row.amountIqd,
            description_ar: row.descriptionAr,
            expense_date: row.expenseDate,
            created_by: row.createdBy,
            created_at: row.createdAt.toISOString(),
          })),
          { request_id: request.requestId, total_iqd: Number(totals?.total ?? 0) },
        ),
      );
    },
  );

  app.post(
    '/api/v1/restaurant-portal/finance/expenses',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'expense.write');
      const body = z
        .object({
          category: z.enum(EXPENSE_CATEGORIES),
          amount_iqd: iqdAmountSchema.refine((v) => v > 0, 'المبلغ يجب أن يكون أكبر من صفر'),
          description_ar: z.string().max(200).optional(),
          expense_date: isoDateSchema,
        })
        .parse(request.body);

      const id = uuidv7();
      await ctx.db.insert(restaurantExpenses).values({
        id,
        restaurantId,
        category: body.category,
        amountIqd: body.amount_iqd,
        descriptionAr: body.description_ar ?? null,
        expenseDate: body.expense_date,
        createdBy: principal.userId,
      });

      return reply.status(201).send(success({ id }, { request_id: request.requestId }));
    },
  );

  // ── Commission statements, restaurant view (plan §42) ─────────────────────

  app.get(
    '/api/v1/restaurant-portal/finance/settlements',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'finance.settlement.read');

      const query = z
        .object({ status: z.enum(SETTLEMENT_STATUSES).optional() })
        .parse(request.query);

      const conditions = [eq(settlements.restaurantId, restaurantId)];
      if (query.status) conditions.push(eq(settlements.status, query.status));

      const rows = await ctx.db
        .select()
        .from(settlements)
        .where(and(...conditions))
        .orderBy(desc(settlements.periodStart))
        .limit(50);

      const now = Date.now();

      return reply.send(
        success(
          rows
            // A DRAFT statement is Finance's working copy, not yet a bill. The
            // restaurant sees it only once issued (plan §41).
            .filter((row) => row.status !== 'DRAFT')
            .map((row) => ({
              id: row.id,
              period_start: row.periodStart.toISOString(),
              period_end: row.periodEnd.toISOString(),
              policy: row.settlementPolicy,
              status: row.status,
              order_count: row.orderCount,
              gross_sales_iqd: row.grossSalesIqd,
              commission_total_iqd: row.commissionTotalIqd,
              adjustments_total_iqd: row.adjustmentsTotalIqd,
              amount_due_iqd: row.amountDueIqd,
              amount_paid_iqd: row.amountPaidIqd,
              remaining_iqd: row.amountDueIqd - row.amountPaidIqd,
              due_date: row.dueDate?.toISOString() ?? null,
              issued_at: row.issuedAt?.toISOString() ?? null,
              days_overdue:
                row.dueDate && row.dueDate.getTime() < now
                  ? Math.floor((now - row.dueDate.getTime()) / 86_400_000)
                  : 0,
            })),
          { request_id: request.requestId },
        ),
      );
    },
  );

  app.get(
    '/api/v1/restaurant-portal/finance/settlements/:settlementId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'finance.settlement.read');
      const { settlementId } = z.object({ settlementId: uuidSchema }).parse(request.params);

      const [settlement] = await ctx.db
        .select()
        .from(settlements)
        .where(
          // Scoped to this restaurant: another restaurant's statement ID
          // resolves to nothing rather than to a 403 that confirms it exists.
          and(eq(settlements.id, settlementId), eq(settlements.restaurantId, restaurantId)),
        )
        .limit(1);

      if (!settlement || settlement.status === 'DRAFT') {
        throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'settlement' } });
      }

      const lines = await ctx.db
        .select({
          publicOrderNumber: orders.publicOrderNumber,
          commissionBaseIqd: settlementLines.commissionBaseIqd,
          rateBps: settlementLines.commissionRateBpsSnapshot,
          commissionAmountIqd: settlementLines.commissionAmountIqd,
          completedAt: settlementLines.orderCompletedAt,
        })
        .from(settlementLines)
        .innerJoin(orders, eq(settlementLines.orderId, orders.id))
        .where(eq(settlementLines.settlementId, settlementId))
        .orderBy(settlementLines.orderCompletedAt);

      const payments = await ctx.db
        .select({
          amountIqd: settlementPayments.amountIqd,
          method: settlementPayments.method,
          reference: settlementPayments.reference,
          paidAt: settlementPayments.paidAt,
        })
        .from(settlementPayments)
        .where(eq(settlementPayments.settlementId, settlementId))
        .orderBy(desc(settlementPayments.paidAt));

      return reply.send(
        success(
          {
            id: settlement.id,
            period_start: settlement.periodStart.toISOString(),
            period_end: settlement.periodEnd.toISOString(),
            policy: settlement.settlementPolicy,
            status: settlement.status,
            order_count: settlement.orderCount,
            gross_sales_iqd: settlement.grossSalesIqd,
            commission_total_iqd: settlement.commissionTotalIqd,
            adjustments_total_iqd: settlement.adjustmentsTotalIqd,
            amount_due_iqd: settlement.amountDueIqd,
            amount_paid_iqd: settlement.amountPaidIqd,
            remaining_iqd: settlement.amountDueIqd - settlement.amountPaidIqd,
            due_date: settlement.dueDate?.toISOString() ?? null,
            issued_at: settlement.issuedAt?.toISOString() ?? null,
            // Same derivation as the list, so a statement does not read as
            // overdue on one screen and current on the other.
            days_overdue:
              settlement.dueDate && settlement.dueDate.getTime() < Date.now()
                ? Math.floor((Date.now() - settlement.dueDate.getTime()) / 86_400_000)
                : 0,
            dispute_reason: settlement.disputeReason,
            // The working, so the restaurant can verify rather than trust.
            lines: lines.map((line) => ({
              public_order_number: line.publicOrderNumber,
              commission_base_iqd: line.commissionBaseIqd,
              rate_display: bpsPercent(line.rateBps),
              commission_amount_iqd: line.commissionAmountIqd,
              completed_at: line.completedAt.toISOString(),
            })),
            payments: payments.map((payment) => ({
              amount_iqd: payment.amountIqd,
              method: payment.method,
              reference: payment.reference,
              paid_at: payment.paidAt.toISOString(),
            })),
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /** Dispute a statement (plan §44). */
  app.post(
    '/api/v1/restaurant-portal/finance/settlements/:settlementId/dispute',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'finance.settlement.dispute');
      const { settlementId } = z.object({ settlementId: uuidSchema }).parse(request.params);
      const body = z.object({ reason: reasonSchema }).parse(request.body);

      await ctx.db.transaction(async (tx) => {
        const [settlement] = await tx
          .select({ status: settlements.status })
          .from(settlements)
          .where(
            and(eq(settlements.id, settlementId), eq(settlements.restaurantId, restaurantId)),
          )
          .for('update')
          .limit(1);

        if (!settlement) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'settlement' } });
        }
        if (!['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(settlement.status)) {
          throw new AppError(ERROR_CODES.SETTLEMENT_INVALID_STATE, {
            details: { status: settlement.status },
          });
        }

        await tx
          .update(settlements)
          .set({
            status: 'DISPUTED',
            disputeReason: body.reason,
            disputedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(settlements.id, settlementId));
      });

      return reply.send(
        success(
          {
            disputed: true,
            note_ar:
              'تم تسجيل اعتراضك. يتوقف احتساب التأخير حتى تراجعه الإدارة المالية وترد عليك.',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  // ── Driver cash custody (plan §54, §96) ──────────────────────────────────

  app.get(
    '/api/v1/restaurant-portal/finance/driver-cash',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'driver.cash.read');

      const events = await ctx.db
        .select({
          driverId: driverCashEvents.driverId,
          driverName: users.fullName,
          type: driverCashEvents.type,
          amountIqd: driverCashEvents.amountIqd,
          createdAt: driverCashEvents.createdAt,
        })
        .from(driverCashEvents)
        .innerJoin(drivers, eq(driverCashEvents.driverId, drivers.id))
        .innerJoin(users, eq(drivers.userId, users.id))
        .where(eq(driverCashEvents.restaurantId, restaurantId));

      // Custody is derived from events, never from a stored running total, so
      // it can always be re-proved from history (plan §96).
      const byDriver = new Map<string, { name: string | null; events: typeof events }>();
      for (const event of events) {
        const entry = byDriver.get(event.driverId) ?? { name: event.driverName, events: [] };
        entry.events.push(event);
        byDriver.set(event.driverId, entry);
      }

      const drivers_ = [...byDriver.entries()].map(([driverId, entry]) => {
        const custody = computeCustody(entry.events);
        return {
          driver_id: driverId,
          driver_name: entry.name,
          collected_iqd: custody.collectedIqd,
          handed_over_iqd: custody.handedOverIqd,
          adjustments_iqd: custody.adjustmentsIqd,
          current_custody_iqd: custody.currentCustodyIqd,
        };
      });

      return reply.send(
        success(drivers_, {
          request_id: request.requestId,
          total_custody_iqd: drivers_.reduce((sum, d) => sum + d.current_custody_iqd, 0),
          note_ar: 'هذه أموال المطعم لدى المندوبين، وليست رصيداً لدى جيبلي.',
        }),
      );
    },
  );

  /**
   * Record a cash handover from a driver (plan §28, §54).
   *
   * Money-moving, so the idempotency key is mandatory: a portal on a weak
   * connection that retries a submit which actually committed must replay the
   * original receipt, not record the driver handing the money over twice.
   */
  app.post(
    '/api/v1/restaurant-portal/finance/driver-cash/handover',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'driver.cash.handover');
      const body = z
        .object({
          driver_id: uuidSchema,
          amount_iqd: iqdAmountSchema.refine((v) => v > 0, 'المبلغ يجب أن يكون أكبر من صفر'),
          reference: z.string().max(80).optional(),
          note: z.string().max(200).optional(),
        })
        .parse(request.body);

      const idempotencyKey = idempotencyKeySchema.parse(
        request.headers['x-idempotency-key'] ?? '',
      );

      const claim = await claimIdempotencyKey<HandoverResponse>(ctx.db, {
        key: idempotencyKey,
        scope: IDEMPOTENCY_SCOPES.DRIVER_CASH_HANDOVER,
        userId: principal.userId,
        requestBody: body,
      });

      if (claim.kind === 'REPLAYED') {
        return reply.status(200).send(
          success(claim.response, { request_id: request.requestId, idempotent_replay: true }),
        );
      }

      if (claim.kind === 'IN_PROGRESS') {
        throw new AppError(ERROR_CODES.CONFLICT, {
          details: { reason: 'REQUEST_IN_PROGRESS', retryAfterSeconds: 2 },
        });
      }


      let handoverId: string;
      try {
        handoverId = await ctx.db.transaction(async (tx) => {
          const events = await tx
            .select({
              type: driverCashEvents.type,
              amountIqd: driverCashEvents.amountIqd,
              createdAt: driverCashEvents.createdAt,
            })
            .from(driverCashEvents)
            .where(
              and(
                eq(driverCashEvents.driverId, body.driver_id),
                eq(driverCashEvents.restaurantId, restaurantId),
              ),
            );

          const custody = computeCustody(events);

          // A driver cannot hand over more than they hold: that would mean the
          // ledger or the cash count is wrong, and both need a human (plan §96).
          const amount = assertHandoverAllowed(custody, body.amount_iqd);

          const id = uuidv7();
          await tx.insert(driverCashHandovers).values({
            id,
            driverId: body.driver_id,
            restaurantId,
            amountIqd: amount,
            receivedByUserId: principal.userId,
            reference: body.reference ?? null,
            note: body.note ?? null,
          });

          // Negative, matching the sign constraint on the type (plan §54).
          await tx.insert(driverCashEvents).values({
            id: uuidv7(),
            driverId: body.driver_id,
            restaurantId,
            type: 'CASH_HANDED_OVER',
            amountIqd: -amount,
            handoverId: id,
            actorUserId: principal.userId,
            note: body.note ?? null,
          });

          return id;
        });
      } catch (error) {
        // Release the claim so a corrected retry can reuse the same key.
        await failIdempotencyKey(ctx.db, {
          key: idempotencyKey,
          scope: IDEMPOTENCY_SCOPES.DRIVER_CASH_HANDOVER,
        });
        throw error;
      }

      const responseBody: HandoverResponse = {
        handover_id: handoverId,
        note_ar: 'التسليم مؤكد ولا يمكن تعديله. أي تصحيح يكون بقيد تسوية.',
      };

      await completeIdempotencyKey(ctx.db, {
        key: idempotencyKey,
        scope: IDEMPOTENCY_SCOPES.DRIVER_CASH_HANDOVER,
        response: responseBody,
        resultEntityId: handoverId,
      });

      return reply.status(201).send(success(responseBody, { request_id: request.requestId }));
    },
  );
}

interface HandoverResponse {
  handover_id: string;
  note_ar: string;
}
