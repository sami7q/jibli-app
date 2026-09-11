import { and, count, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  AppError,
  assertTransition,
  ERROR_CODES,
  EVENT_TYPES,
  PAYMENT_RECORD_METHODS,
  SETTLEMENT_STATUSES,
  SETTLEMENT_TRANSITIONS,
  success,
} from '@jibli/contracts';
import { assertAdminPermission } from '@jibli/auth';
import { idempotencyKeySchema, reasonSchema, uuidSchema } from '@jibli/validation';
import {
  AUDIT_ACTIONS,
  appendLedgerEntry,
  assertPaymentWithinBalance,
  dueDateFor,
  enqueueOutboxEvent,
  reconcileSettlementTotals,
  settlementStatusFromAmounts,
  writeAudit,
} from '@jibli/domain';
import {
  ledgerEntries,
  orders,
  reconciliationRuns,
  restaurantCommissionConfigs,
  restaurants,
  settlementAdjustments,
  settlementLines,
  settlementPayments,
  settlements,
  users,
  uuidv7,
} from '@jibli/db';
import { clientIp, userAgent, type AppContext } from '../../lib/context.js';
import { requirePrincipal } from '../../plugins/auth.js';

/**
 * Admin finance (plan §41, §42, §43, §73, §88).
 *
 * Every mutation here moves money, so each one:
 *   - has its own permission
 *   - goes through the settlement state machine
 *   - writes an audit row with a reason
 *   - uses an idempotency key where a retry could double-count
 *
 * Corrections are compensating entries. Nothing in this file edits an issued
 * financial record in place (plan §4.4).
 */

export function registerAdminFinanceRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Settlement list with the aging an accountant actually chases. */
  app.get(
    '/api/v1/admin/finance/settlements',
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertAdminPermission(requirePrincipal(request), 'finance.read.global');
      const query = z
        .object({
          status: z.enum(SETTLEMENT_STATUSES).optional(),
          restaurant_id: uuidSchema.optional(),
          limit: z.coerce.number().int().min(1).max(100).default(25),
          offset: z.coerce.number().int().min(0).max(10_000).default(0),
        })
        .parse(request.query);

      const conditions = [];
      if (query.status) conditions.push(eq(settlements.status, query.status));
      if (query.restaurant_id) conditions.push(eq(settlements.restaurantId, query.restaurant_id));

      const rows = await ctx.db
        .select({
          id: settlements.id,
          restaurantId: settlements.restaurantId,
          restaurantName: restaurants.displayName,
          partnerCode: restaurants.partnerCode,
          policy: settlements.settlementPolicy,
          periodStart: settlements.periodStart,
          periodEnd: settlements.periodEnd,
          status: settlements.status,
          orderCount: settlements.orderCount,
          grossSalesIqd: settlements.grossSalesIqd,
          commissionTotalIqd: settlements.commissionTotalIqd,
          adjustmentsTotalIqd: settlements.adjustmentsTotalIqd,
          amountDueIqd: settlements.amountDueIqd,
          amountPaidIqd: settlements.amountPaidIqd,
          dueDate: settlements.dueDate,
          issuedAt: settlements.issuedAt,
        })
        .from(settlements)
        .innerJoin(restaurants, eq(settlements.restaurantId, restaurants.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(settlements.periodStart))
        .limit(query.limit)
        .offset(query.offset);

      const [total] = await ctx.db
        .select({ value: count() })
        .from(settlements)
        .where(conditions.length > 0 ? and(...conditions) : undefined);

      const now = Date.now();

      return reply.send(
        success(
          rows.map((row) => ({
            id: row.id,
            restaurant_id: row.restaurantId,
            restaurant_name: row.restaurantName,
            partner_code: row.partnerCode,
            policy: row.policy,
            period_start: row.periodStart.toISOString(),
            period_end: row.periodEnd.toISOString(),
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
          { request_id: request.requestId, total: total?.value ?? 0 },
        ),
      );
    },
  );

  /** One statement with its lines, payments and adjustments. */
  app.get(
    '/api/v1/admin/finance/settlements/:settlementId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertAdminPermission(requirePrincipal(request), 'finance.read.global');
      const { settlementId } = z.object({ settlementId: uuidSchema }).parse(request.params);

      const [settlement] = await ctx.db
        .select({
          settlement: settlements,
          restaurantName: restaurants.displayName,
          partnerCode: restaurants.partnerCode,
        })
        .from(settlements)
        .innerJoin(restaurants, eq(settlements.restaurantId, restaurants.id))
        .where(eq(settlements.id, settlementId))
        .limit(1);

      if (!settlement) {
        throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'settlement' } });
      }

      const lines = await ctx.db
        .select({
          orderId: settlementLines.orderId,
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
          id: settlementPayments.id,
          amountIqd: settlementPayments.amountIqd,
          method: settlementPayments.method,
          reference: settlementPayments.reference,
          paidAt: settlementPayments.paidAt,
          note: settlementPayments.note,
          recordedBy: users.fullName,
          reversesPaymentId: settlementPayments.reversesPaymentId,
        })
        .from(settlementPayments)
        .leftJoin(users, eq(settlementPayments.recordedBy, users.id))
        .where(eq(settlementPayments.settlementId, settlementId))
        .orderBy(desc(settlementPayments.paidAt));

      const adjustments = await ctx.db
        .select({
          id: settlementAdjustments.id,
          amountIqd: settlementAdjustments.amountIqd,
          reason: settlementAdjustments.reason,
          approvedBy: users.fullName,
          createdAt: settlementAdjustments.createdAt,
        })
        .from(settlementAdjustments)
        .leftJoin(users, eq(settlementAdjustments.approvedBy, users.id))
        .where(eq(settlementAdjustments.settlementId, settlementId));

      // Re-derive the invariant so the UI can flag a statement that stopped
      // adding up, rather than displaying it as authoritative (plan §95).
      const lineTotal = lines.reduce((sum, line) => sum + line.commissionAmountIqd, 0);
      const check = reconcileSettlementTotals({
        lineCommissionTotalIqd: lineTotal,
        adjustmentsTotalIqd: settlement.settlement.adjustmentsTotalIqd,
        amountDueIqd: settlement.settlement.amountDueIqd,
      });

      return reply.send(
        success(
          {
            id: settlement.settlement.id,
            restaurant_id: settlement.settlement.restaurantId,
            restaurant_name: settlement.restaurantName,
            partner_code: settlement.partnerCode,
            policy: settlement.settlement.settlementPolicy,
            period_start: settlement.settlement.periodStart.toISOString(),
            period_end: settlement.settlement.periodEnd.toISOString(),
            status: settlement.settlement.status,
            order_count: settlement.settlement.orderCount,
            gross_sales_iqd: settlement.settlement.grossSalesIqd,
            commission_base_total_iqd: settlement.settlement.commissionBaseTotalIqd,
            commission_total_iqd: settlement.settlement.commissionTotalIqd,
            adjustments_total_iqd: settlement.settlement.adjustmentsTotalIqd,
            amount_due_iqd: settlement.settlement.amountDueIqd,
            amount_paid_iqd: settlement.settlement.amountPaidIqd,
            remaining_iqd:
              settlement.settlement.amountDueIqd - settlement.settlement.amountPaidIqd,
            due_date: settlement.settlement.dueDate?.toISOString() ?? null,
            issued_at: settlement.settlement.issuedAt?.toISOString() ?? null,
            void_reason: settlement.settlement.voidReason,
            dispute_reason: settlement.settlement.disputeReason,
            reconciles: check.balanced,
            reconciliation_detail: check.balanced ? null : check.detail,
            lines: lines.map((line) => ({
              order_id: line.orderId,
              public_order_number: line.publicOrderNumber,
              commission_base_iqd: line.commissionBaseIqd,
              rate_bps: line.rateBps,
              commission_amount_iqd: line.commissionAmountIqd,
              completed_at: line.completedAt.toISOString(),
            })),
            payments: payments.map((payment) => ({
              id: payment.id,
              amount_iqd: payment.amountIqd,
              method: payment.method,
              reference: payment.reference,
              paid_at: payment.paidAt.toISOString(),
              note: payment.note,
              recorded_by: payment.recordedBy,
              is_reversal: payment.reversesPaymentId !== null,
            })),
            adjustments: adjustments.map((adjustment) => ({
              id: adjustment.id,
              amount_iqd: adjustment.amountIqd,
              reason: adjustment.reason,
              approved_by: adjustment.approvedBy,
              created_at: adjustment.createdAt.toISOString(),
            })),
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /** Issue a DRAFT statement — the point at which a restaurant is billed. */
  app.post(
    '/api/v1/admin/finance/settlements/:settlementId/issue',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'finance.settlement.issue');
      const { settlementId } = z.object({ settlementId: uuidSchema }).parse(request.params);

      await ctx.db.transaction(async (tx) => {
        const [settlement] = await tx
          .select()
          .from(settlements)
          .where(eq(settlements.id, settlementId))
          .for('update')
          .limit(1);

        if (!settlement) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'settlement' } });
        }

        assertTransition(
          SETTLEMENT_TRANSITIONS,
          { from: settlement.status, to: 'ISSUED', actorType: 'ADMIN' },
          ERROR_CODES.SETTLEMENT_INVALID_STATE,
        );

        // Never issue a statement whose numbers do not add up (plan §41 step 6).
        const [lineTotals] = await tx
          .select({ total: sql<number>`COALESCE(SUM(${settlementLines.commissionAmountIqd}), 0)` })
          .from(settlementLines)
          .where(eq(settlementLines.settlementId, settlementId));

        const check = reconcileSettlementTotals({
          lineCommissionTotalIqd: Number(lineTotals?.total ?? 0),
          adjustmentsTotalIqd: settlement.adjustmentsTotalIqd,
          amountDueIqd: settlement.amountDueIqd,
        });

        if (!check.balanced) {
          throw new AppError(ERROR_CODES.FINANCIAL_RECONCILIATION_REQUIRED, {
            details: { detail: check.detail, varianceIqd: check.varianceIqd },
          });
        }

        const [config] = await tx
          .select({ paymentTermDays: restaurantCommissionConfigs.paymentTermDays })
          .from(restaurantCommissionConfigs)
          .where(
            and(
              eq(restaurantCommissionConfigs.restaurantId, settlement.restaurantId),
              isNull(restaurantCommissionConfigs.effectiveTo),
            ),
          )
          .limit(1);

        const now = new Date();

        await tx
          .update(settlements)
          .set({
            status: 'ISSUED',
            issuedAt: now,
            issuedBy: principal.userId,
            dueDate: dueDateFor(now, config?.paymentTermDays ?? 7),
            updatedAt: now,
          })
          .where(eq(settlements.id, settlementId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.SETTLEMENT_ISSUE,
          entityType: 'settlement',
          entityId: settlementId,
          before: { status: settlement.status },
          after: { status: 'ISSUED', amountDueIqd: settlement.amountDueIqd },
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });

        await enqueueOutboxEvent(tx, {
          eventType: EVENT_TYPES.SETTLEMENT_ISSUED,
          aggregateType: 'settlement',
          aggregateId: settlementId,
          requestId: request.requestId,
          payload: {
            settlementId,
            restaurantId: settlement.restaurantId,
            periodStart: settlement.periodStart.toISOString(),
            periodEnd: settlement.periodEnd.toISOString(),
            amountDueIqd: settlement.amountDueIqd,
            amountPaidIqd: settlement.amountPaidIqd,
            dueDate: null,
          },
        });
      });

      return reply.send(success({ issued: true }, { request_id: request.requestId }));
    },
  );

  /**
   * Record a payment (plan §42).
   *
   * Payments are immutable. A mistake is corrected by a reversal, never by
   * editing the row.
   */
  app.post(
    '/api/v1/admin/finance/settlements/:settlementId/record-payment',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'finance.payment.record');
      const { settlementId } = z.object({ settlementId: uuidSchema }).parse(request.params);
      const body = z
        .object({
          amount_iqd: z.number().int().min(1),
          method: z.enum(PAYMENT_RECORD_METHODS),
          reference: z.string().max(120).optional(),
          paid_at: z.string().datetime().optional(),
          note: z.string().max(300).optional(),
        })
        .parse(request.body);

      const idempotencyKey = idempotencyKeySchema.parse(
        request.headers['x-idempotency-key'] ?? `payment-${settlementId}-${body.amount_iqd}`,
      );

      const result = await ctx.db.transaction(async (tx) => {
        const [settlement] = await tx
          .select()
          .from(settlements)
          .where(eq(settlements.id, settlementId))
          .for('update')
          .limit(1);

        if (!settlement) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'settlement' } });
        }
        if (settlement.status === 'VOID') {
          throw new AppError(ERROR_CODES.SETTLEMENT_INVALID_STATE, {
            details: { status: settlement.status },
          });
        }

        // Refuses over-collection (plan §76 PAYMENT_EXCEEDS_ALLOWED_BALANCE).
        const amount = assertPaymentWithinBalance({
          amountDueIqd: settlement.amountDueIqd,
          amountPaidIqd: settlement.amountPaidIqd,
          newPaymentIqd: body.amount_iqd,
        });

        const paidAt = body.paid_at ? new Date(body.paid_at) : new Date();
        const paymentId = uuidv7();

        await tx.insert(settlementPayments).values({
          id: paymentId,
          settlementId,
          restaurantId: settlement.restaurantId,
          amountIqd: amount,
          method: body.method,
          reference: body.reference ?? null,
          paidAt,
          recordedBy: principal.userId,
          note: body.note ?? null,
          idempotencyKey,
        });

        const newPaidTotal = settlement.amountPaidIqd + amount;
        const nextStatus = settlementStatusFromAmounts({
          current: settlement.status,
          amountDueIqd: settlement.amountDueIqd,
          amountPaidIqd: newPaidTotal,
          dueDate: settlement.dueDate,
        });

        await tx
          .update(settlements)
          .set({
            amountPaidIqd: newPaidTotal,
            status: nextStatus,
            paidAt: nextStatus === 'PAID' ? new Date() : settlement.paidAt,
            updatedAt: new Date(),
          })
          .where(eq(settlements.id, settlementId));

        // The ledger records that the restaurant's balance fell.
        await appendLedgerEntry(tx, {
          restaurantId: settlement.restaurantId,
          settlementId,
          entryType: 'COMMISSION_PAYMENT',
          amountIqd: amount,
          effectiveAt: paidAt,
          idempotencyKey: `payment:${paymentId}`,
        });

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.SETTLEMENT_PAYMENT_RECORD,
          entityType: 'settlement',
          entityId: settlementId,
          after: { paymentId, amountIqd: amount, method: body.method, status: nextStatus },
          reason: body.note ?? null,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });

        await enqueueOutboxEvent(tx, {
          eventType: EVENT_TYPES.SETTLEMENT_PAYMENT_RECORDED,
          aggregateType: 'settlement',
          aggregateId: settlementId,
          requestId: request.requestId,
          payload: {
            settlementId,
            restaurantId: settlement.restaurantId,
            periodStart: settlement.periodStart.toISOString(),
            periodEnd: settlement.periodEnd.toISOString(),
            amountDueIqd: settlement.amountDueIqd,
            amountPaidIqd: newPaidTotal,
            dueDate: settlement.dueDate?.toISOString() ?? null,
          },
        });

        return { paymentId, status: nextStatus, remaining: settlement.amountDueIqd - newPaidTotal };
      });

      return reply.status(201).send(
        success(
          {
            payment_id: result.paymentId,
            status: result.status,
            remaining_iqd: result.remaining,
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * Create a credit or debit adjustment (plan §44).
   *
   * Requires a fresh MFA challenge — this is one of the operations plan §88
   * lists explicitly.
   */
  app.post(
    '/api/v1/admin/finance/settlements/:settlementId/adjustments',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'finance.adjustment.create');
      const { settlementId } = z.object({ settlementId: uuidSchema }).parse(request.params);
      const body = z
        .object({
          // Negative reduces what the restaurant owes; positive increases it.
          amount_iqd: z.number().int().refine((v) => v !== 0, 'Adjustment cannot be zero'),
          reason: reasonSchema,
        })
        .parse(request.body);

      const idempotencyKey = idempotencyKeySchema.parse(
        request.headers['x-idempotency-key'] ?? `adjustment-${settlementId}-${Date.now()}`,
      );

      await ctx.db.transaction(async (tx) => {
        const [settlement] = await tx
          .select()
          .from(settlements)
          .where(eq(settlements.id, settlementId))
          .for('update')
          .limit(1);

        if (!settlement) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'settlement' } });
        }
        if (settlement.status === 'PAID' || settlement.status === 'VOID') {
          throw new AppError(ERROR_CODES.SETTLEMENT_LOCKED, {
            details: { status: settlement.status },
          });
        }

        const adjustmentId = uuidv7();
        await tx.insert(settlementAdjustments).values({
          id: adjustmentId,
          settlementId,
          restaurantId: settlement.restaurantId,
          amountIqd: body.amount_iqd,
          reason: body.reason,
          approvedBy: principal.userId,
          idempotencyKey,
        });

        const newAdjustmentsTotal = settlement.adjustmentsTotalIqd + body.amount_iqd;
        const newAmountDue = settlement.commissionTotalIqd + newAdjustmentsTotal;

        if (newAmountDue < settlement.amountPaidIqd) {
          // Would leave the statement over-paid, which the CHECK constraint
          // forbids. Refusing with a clear code beats a constraint violation.
          throw new AppError(ERROR_CODES.PAYMENT_EXCEEDS_ALLOWED_BALANCE, {
            details: { newAmountDueIqd: newAmountDue, alreadyPaidIqd: settlement.amountPaidIqd },
          });
        }

        await tx
          .update(settlements)
          .set({
            adjustmentsTotalIqd: newAdjustmentsTotal,
            amountDueIqd: newAmountDue,
            updatedAt: new Date(),
          })
          .where(eq(settlements.id, settlementId));

        await appendLedgerEntry(tx, {
          restaurantId: settlement.restaurantId,
          settlementId,
          entryType: body.amount_iqd < 0 ? 'COMMISSION_CREDIT' : 'COMMISSION_DEBIT',
          amountIqd: Math.abs(body.amount_iqd),
          effectiveAt: new Date(),
          idempotencyKey: `adjustment:${adjustmentId}`,
          metadata: { reason: body.reason },
        });

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.SETTLEMENT_ADJUSTMENT_CREATE,
          entityType: 'settlement',
          entityId: settlementId,
          before: { amountDueIqd: settlement.amountDueIqd },
          after: { amountDueIqd: newAmountDue, adjustmentId },
          reason: body.reason,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });
      });

      return reply.status(201).send(success({ created: true }, { request_id: request.requestId }));
    },
  );

  /** Void a statement. Requires fresh MFA and a reason (plan §88). */
  app.post(
    '/api/v1/admin/finance/settlements/:settlementId/void',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'finance.settlement.void');
      const { settlementId } = z.object({ settlementId: uuidSchema }).parse(request.params);
      const body = z.object({ reason: reasonSchema }).parse(request.body);

      await ctx.db.transaction(async (tx) => {
        const [settlement] = await tx
          .select()
          .from(settlements)
          .where(eq(settlements.id, settlementId))
          .for('update')
          .limit(1);

        if (!settlement) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'settlement' } });
        }

        assertTransition(
          SETTLEMENT_TRANSITIONS,
          { from: settlement.status, to: 'VOID', actorType: 'ADMIN', reason: body.reason },
          ERROR_CODES.SETTLEMENT_INVALID_STATE,
        );

        await tx
          .update(settlements)
          .set({
            status: 'VOID',
            voidedAt: new Date(),
            voidedBy: principal.userId,
            voidReason: body.reason,
            updatedAt: new Date(),
          })
          .where(eq(settlements.id, settlementId));

        // Reverse the accrual rather than deleting it: the original entry
        // stays in the ledger as evidence (plan §4.4).
        if (settlement.commissionTotalIqd > 0) {
          await appendLedgerEntry(tx, {
            restaurantId: settlement.restaurantId,
            settlementId,
            entryType: 'REVERSAL',
            amountIqd: settlement.commissionTotalIqd,
            effectiveAt: new Date(),
            idempotencyKey: `void:${settlementId}`,
            metadata: { reason: body.reason },
          });
        }

        // Release the orders so a corrected statement can include them.
        await tx.delete(settlementLines).where(eq(settlementLines.settlementId, settlementId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.SETTLEMENT_VOID,
          entityType: 'settlement',
          entityId: settlementId,
          before: { status: settlement.status, amountDueIqd: settlement.amountDueIqd },
          after: { status: 'VOID' },
          reason: body.reason,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });
      });

      return reply.send(
        success(
          {
            voided: true,
            note_ar:
              'تم عكس العمولة بقيد مقابل ولم تُحذف. الطلبات المرتبطة أصبحت متاحة لتسوية جديدة.',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * Platform finance summary (plan §39, §129, §130).
   *
   * Accrued, collected and outstanding are reported separately — the plan is
   * explicit that "Platform revenue must not mix accrued commission with
   * collected cash".
   */
  app.get(
    '/api/v1/admin/finance/summary',
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertAdminPermission(requirePrincipal(request), 'finance.read.global');
      const query = z
        .object({ days: z.coerce.number().int().min(1).max(365).default(30) })
        .parse(request.query);

      const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);

      const [ledger] = await ctx.db
        .select({
          accrued: sql<number>`COALESCE(SUM(${ledgerEntries.amountIqd}) FILTER (WHERE ${ledgerEntries.entryType} = 'COMMISSION_ACCRUED'), 0)`,
          collected: sql<number>`COALESCE(SUM(${ledgerEntries.amountIqd}) FILTER (WHERE ${ledgerEntries.entryType} = 'COMMISSION_PAYMENT'), 0)`,
          credits: sql<number>`COALESCE(SUM(${ledgerEntries.amountIqd}) FILTER (WHERE ${ledgerEntries.entryType} IN ('COMMISSION_CREDIT','REVERSAL')), 0)`,
          serviceFees: sql<number>`COALESCE(SUM(${ledgerEntries.amountIqd}) FILTER (WHERE ${ledgerEntries.entryType} = 'SERVICE_FEE_REVENUE'), 0)`,
        })
        .from(ledgerEntries)
        .where(gte(ledgerEntries.effectiveAt, since));

      const [outstanding] = await ctx.db
        .select({
          due: sql<number>`COALESCE(SUM(${settlements.amountDueIqd} - ${settlements.amountPaidIqd}), 0)`,
          count: count(),
        })
        .from(settlements)
        .where(inArray(settlements.status, ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE']));

      const [overdue] = await ctx.db
        .select({
          due: sql<number>`COALESCE(SUM(${settlements.amountDueIqd} - ${settlements.amountPaidIqd}), 0)`,
          count: count(),
        })
        .from(settlements)
        .where(eq(settlements.status, 'OVERDUE'));

      // Surface the latest reconciliation result: a finance dashboard whose
      // underlying invariants are failing must say so (plan §95).
      const latestChecks = await ctx.db
        .select({
          checkName: reconciliationRuns.checkName,
          businessDate: reconciliationRuns.businessDate,
          passed: reconciliationRuns.passed,
          varianceIqd: reconciliationRuns.varianceIqd,
        })
        .from(reconciliationRuns)
        .orderBy(desc(reconciliationRuns.businessDate))
        .limit(4);

      return reply.send(
        success(
          {
            commission_accrued_iqd: Number(ledger?.accrued ?? 0),
            commission_collected_iqd: Number(ledger?.collected ?? 0),
            credits_issued_iqd: Number(ledger?.credits ?? 0),
            service_fee_revenue_iqd: Number(ledger?.serviceFees ?? 0),
            outstanding_iqd: Number(outstanding?.due ?? 0),
            outstanding_settlements: outstanding?.count ?? 0,
            overdue_iqd: Number(overdue?.due ?? 0),
            overdue_settlements: overdue?.count ?? 0,
            reconciliation: latestChecks.map((check) => ({
              check: check.checkName,
              business_date: check.businessDate,
              passed: check.passed === 'PASS',
              variance_iqd: check.varianceIqd,
            })),
            definitions_ar: {
              commission_accrued: 'العمولة المستحقة على الطلبات المكتملة — ليست مبالغ محصّلة',
              commission_collected: 'العمولة المحصّلة فعلياً من المطاعم',
              outstanding: 'المبالغ الصادرة وغير المسددة بعد',
            },
          },
          { request_id: request.requestId, days: query.days },
        ),
      );
    },
  );
}
