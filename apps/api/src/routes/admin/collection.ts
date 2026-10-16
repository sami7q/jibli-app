import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, ERROR_CODES, success } from '@jibli/contracts';
import { assertAdminPermission } from '@jibli/auth';
import { uuidSchema } from '@jibli/validation';
import { AUDIT_ACTIONS, appendLedgerEntry, writeAudit } from '@jibli/domain';
import { addIqd, iqd } from '@jibli/money';
import {
  orders,
  restaurants,
  settlementLines,
  settlementPayments,
  settlements,
  users,
  uuidv7,
} from '@jibli/db';
import { clientIp, userAgent, type AppContext } from '../../lib/context.js';
import { requirePrincipal } from '../../plugins/auth.js';
import { attachServiceFees } from '../../services/service-fee-settlement.js';

/**
 * Collecting the commission a restaurant owes, in one action.
 *
 * The commission screen shows a figure accumulating per restaurant; this is the
 * button that says "I have that money now". Pressing it must do three things at
 * once, or the books stop agreeing with the screen: the outstanding figure goes
 * to zero, the orders behind it stop being outstanding, and the amount lands
 * somewhere permanent.
 *
 * It is deliberately not a new "collections" table. A collection *is* a
 * settlement that was issued and paid in the same breath — same lines, same
 * ledger entries, same reconciliation. A parallel table would be a second
 * source of truth about what a restaurant has paid, and the first time the two
 * disagreed nobody would know which was right.
 *
 * So: create the statement over exactly the unsettled orders, record the
 * payment, and let the settlement history be the archive. Every screen that
 * already reads settlements — the restaurant's own portal included — shows it
 * without being taught anything new.
 */

export function registerAdminCollectionRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * What is collectable right now, per restaurant.
   *
   * The same definition the commission overview uses — a completed order that
   * no settlement line claims — so the button always matches the figure beside
   * it.
   */
  app.get(
    '/api/v1/admin/finance/collectable',
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertAdminPermission(requirePrincipal(request), 'finance.read.global');

      const rows = await ctx.db
        .select({
          restaurantId: restaurants.id,
          displayName: restaurants.displayName,
          partnerCode: restaurants.partnerCode,
          orderCount: sql<number>`COUNT(${orders.id})`,
          commissionIqd: sql<number>`COALESCE(SUM(${orders.commissionAmountIqd}), 0)`,
          serviceFeeIqd: sql<number>`COALESCE(SUM(${orders.platformServiceFeeIqd}), 0)`,
          grossSalesIqd: sql<number>`COALESCE(SUM(${orders.customerTotalIqd}), 0)`,
          oldestAt: sql<string | null>`MIN(${orders.completedAt})`,
          newestAt: sql<string | null>`MAX(${orders.completedAt})`,
        })
        .from(orders)
        .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
        .leftJoin(settlementLines, eq(settlementLines.orderId, orders.id))
        .where(and(eq(orders.status, 'COMPLETED'), isNull(settlementLines.id)))
        .groupBy(restaurants.id, restaurants.displayName, restaurants.partnerCode)
        .orderBy(
          desc(
            sql`COALESCE(SUM(${orders.commissionAmountIqd}), 0) + COALESCE(SUM(${orders.platformServiceFeeIqd}), 0)`,
          ),
        );

      return reply.send(
        success(
          rows.map((row) => ({
            restaurant_id: row.restaurantId,
            display_name: row.displayName,
            partner_code: row.partnerCode,
            order_count: Number(row.orderCount),
            commission_iqd: Number(row.commissionIqd),
            service_fee_iqd: Number(row.serviceFeeIqd),
            /** What the platform earned on these orders: commission plus service fee. */
            profit_iqd: Number(row.commissionIqd) + Number(row.serviceFeeIqd),
            gross_sales_iqd: Number(row.grossSalesIqd),
            oldest_order_at: row.oldestAt ? new Date(row.oldestAt).toISOString() : null,
            newest_order_at: row.newestAt ? new Date(row.newestAt).toISOString() : null,
          })),
          { request_id: request.requestId },
        ),
      );
    },
  );

  /** Collect it. */
  app.post(
    '/api/v1/admin/finance/collect',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      // Step-up: this records money as received, which is not undoable by
      // editing — only by a compensating entry.
      assertAdminPermission(principal, 'finance.payment.record');

      const body = z
        .object({
          restaurant_id: uuidSchema,
          method: z.enum(['CASH', 'BANK_TRANSFER', 'OTHER']).default('CASH'),
          reference: z.string().trim().max(120).optional(),
          // A free-form optional note, not a reason that must justify an action:
          // reasonSchema's minimum length rejected a one-word note on a field
          // labelled «اختياري» (ADMIN-20).
          note: z.string().trim().max(500).optional(),
        })
        .parse(request.body);

      const result = await ctx.db.transaction(async (tx) => {
        const [restaurant] = await tx
          .select({ id: restaurants.id, displayName: restaurants.displayName })
          .from(restaurants)
          .where(eq(restaurants.id, body.restaurant_id))
          .limit(1);

        if (!restaurant) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'restaurant' } });
        }

        /*
         * Locked while we read them. Two operators pressing collect at the same
         * moment would otherwise both see the same orders and write two
         * statements over them; the unique index on settlement_lines.order_id
         * would stop the second, but with a 500 rather than an answer.
         */
        const eligible = await tx
          .select({
            id: orders.id,
            customerTotalIqd: orders.customerTotalIqd,
            commissionBaseIqd: orders.commissionBaseIqd,
            commissionFlatIqdSnapshot: orders.commissionFlatIqdSnapshot,
            commissionAmountIqd: orders.commissionAmountIqd,
            completedAt: orders.completedAt,
          })
          .from(orders)
          .leftJoin(settlementLines, eq(settlementLines.orderId, orders.id))
          .where(
            and(
              eq(orders.restaurantId, body.restaurant_id),
              eq(orders.status, 'COMPLETED'),
              isNull(settlementLines.id),
            ),
          )
          .for('update', { of: orders });

        if (eligible.length === 0) {
          throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
            details: { reason: 'NOTHING_TO_COLLECT' },
            messageAr: 'لا توجد أرباح غير محصّلة على هذا المتجر',
          });
        }

        const completedTimes = eligible
          .map((order) => order.completedAt)
          .filter((value): value is Date => value !== null)
          .map((value) => value.getTime());

        const periodStart = new Date(Math.min(...completedTimes));
        // Half-open, and the end is a moment after the last order rather than
        // that order's own timestamp: a period that excludes its last member
        // is a period that does not contain what it settles.
        const periodEnd = new Date(Math.max(...completedTimes) + 1000);

        const grossSales = addIqd(...eligible.map((o) => iqd(o.customerTotalIqd)));
        const commissionBaseTotal = addIqd(...eligible.map((o) => iqd(o.commissionBaseIqd)));
        const commissionTotal = addIqd(...eligible.map((o) => iqd(o.commissionAmountIqd)));

        const now = new Date();
        const settlementId = uuidv7();

        await tx.insert(settlements).values({
          id: settlementId,
          restaurantId: body.restaurant_id,
          settlementPolicy: 'HALF_MONTH',
          periodStart,
          periodEnd,
          // Straight to PAID: the money is in hand, which is what pressing the
          // button asserts. There is no review step to wait for.
          status: 'PAID',
          orderCount: eligible.length,
          grossSalesIqd: grossSales,
          commissionBaseTotalIqd: commissionBaseTotal,
          commissionTotalIqd: commissionTotal,
          adjustmentsTotalIqd: 0,
          amountDueIqd: commissionTotal,
          amountPaidIqd: commissionTotal,
          issuedAt: now,
          dueDate: now,
          paidAt: now,
        });

        await tx.insert(settlementLines).values(
          eligible.map((order) => ({
            id: uuidv7(),
            settlementId,
            orderId: order.id,
            commissionBaseIqd: order.commissionBaseIqd,
            commissionFlatIqdSnapshot: order.commissionFlatIqdSnapshot,
            commissionAmountIqd: order.commissionAmountIqd,
            orderCompletedAt: order.completedAt as Date,
          })),
        );

        // The service fees ride on the same statement, so one press collects
        // everything the shop holds for the platform on these orders.
        const serviceFeeTotal = await attachServiceFees(tx, {
          settlementId,
          restaurantId: body.restaurant_id,
          approvedBy: principal.userId,
        });
        const collectedTotal = commissionTotal + serviceFeeTotal;

        await tx
          .update(settlements)
          .set({ amountPaidIqd: collectedTotal })
          .where(eq(settlements.id, settlementId));

        await tx.insert(settlementPayments).values({
          id: uuidv7(),
          settlementId,
          restaurantId: body.restaurant_id,
          amountIqd: collectedTotal,
          method: body.method,
          reference: body.reference ?? null,
          paidAt: now,
          recordedBy: principal.userId,
          note: body.note ?? null,
          // The settlement id, so a double-submitted button cannot record the
          // same money twice: the unique index refuses the second.
          idempotencyKey: `collect:${settlementId}`,
        });

        /*
         * The ledger entry is what makes reconciliation work: the nightly job
         * checks that commission accrued on orders equals commission settled,
         * and a payment recorded without one would show up as a permanent
         * imbalance.
         */
        await appendLedgerEntry(tx, {
          restaurantId: body.restaurant_id,
          settlementId,
          entryType: 'COMMISSION_PAYMENT',
          amountIqd: collectedTotal,
          effectiveAt: now,
          idempotencyKey: `collect:${settlementId}`,
          metadata: { orderCount: eligible.length, method: body.method },
        });

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.COMMISSION_COLLECT,
          entityType: 'settlement',
          entityId: settlementId,
          after: {
            restaurantId: body.restaurant_id,
            orderCount: eligible.length,
            amountIqd: collectedTotal,
            commissionIqd: commissionTotal,
            serviceFeeIqd: serviceFeeTotal,
            method: body.method,
          },
          reason: body.note ?? null,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });

        return {
          settlementId,
          restaurantName: restaurant.displayName,
          orderCount: eligible.length,
          amountIqd: collectedTotal,
        };
      });

      return reply.status(201).send(
        success(
          {
            settlement_id: result.settlementId,
            order_count: result.orderCount,
            collected_iqd: result.amountIqd,
            note_ar: `حُصّلت ${result.amountIqd.toLocaleString('en-US')} د.ع من ${result.restaurantName} عن ${result.orderCount} طلباً. صارت الأرباح المعلّقة صفراً وانتقل المبلغ إلى الأرشيف.`,
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * The archive: everything collected, newest first.
   *
   * Reads settlements that carry a payment, which is the same record the
   * restaurant sees in its own portal — one history, two audiences.
   */
  app.get(
    '/api/v1/admin/finance/collections',
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertAdminPermission(requirePrincipal(request), 'finance.read.global');
      const query = z
        .object({
          restaurant_id: uuidSchema.optional(),
          limit: z.coerce.number().int().min(1).max(200).default(60),
        })
        .parse(request.query);

      const conditions = [eq(settlements.status, 'PAID')];
      if (query.restaurant_id) {
        conditions.push(eq(settlements.restaurantId, query.restaurant_id));
      }

      const rows = await ctx.db
        .select({
          id: settlements.id,
          restaurantId: settlements.restaurantId,
          restaurantName: restaurants.displayName,
          partnerCode: restaurants.partnerCode,
          periodStart: settlements.periodStart,
          periodEnd: settlements.periodEnd,
          orderCount: settlements.orderCount,
          grossSalesIqd: settlements.grossSalesIqd,
          amountPaidIqd: settlements.amountPaidIqd,
          paidAt: settlements.paidAt,
          method: settlementPayments.method,
          reference: settlementPayments.reference,
          recordedByName: users.fullName,
        })
        .from(settlements)
        .innerJoin(restaurants, eq(restaurants.id, settlements.restaurantId))
        .leftJoin(settlementPayments, eq(settlementPayments.settlementId, settlements.id))
        .leftJoin(users, eq(users.id, settlementPayments.recordedBy))
        .where(and(...conditions))
        .orderBy(desc(settlements.paidAt))
        .limit(query.limit);

      const total = rows.reduce((sum, row) => sum + Number(row.amountPaidIqd), 0);

      return reply.send(
        success(
          {
            total_collected_iqd: total,
            collections: rows.map((row) => ({
              settlement_id: row.id,
              restaurant_id: row.restaurantId,
              restaurant_name: row.restaurantName,
              partner_code: row.partnerCode,
              period_start: row.periodStart.toISOString(),
              period_end: row.periodEnd.toISOString(),
              order_count: row.orderCount,
              gross_sales_iqd: row.grossSalesIqd,
              amount_iqd: row.amountPaidIqd,
              collected_at: row.paidAt?.toISOString() ?? null,
              method: row.method,
              reference: row.reference,
              recorded_by: row.recordedByName,
            })),
          },
          { request_id: request.requestId },
        ),
      );
    },
  );
}
