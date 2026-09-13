import { and, eq, gte, inArray, isNull, lt, notInArray, sql } from 'drizzle-orm';
import { EVENT_TYPES, type SettlementPolicy } from '@jibli/contracts';
import { addIqd, iqd, type Iqd } from '@jibli/money';
import {
  AUDIT_ACTIONS,
  dueDateFor,
  enqueueOutboxEvent,
  previousPeriod,
  reconcileSettlementTotals,
  writeAudit,
  type SettlementPeriod,
} from '@jibli/domain';
import {
  orders,
  restaurantCommissionConfigs,
  restaurants,
  settlementAdjustments,
  settlementLines,
  settlements,
  uuidv7,
} from '@jibli/db';
import type { WorkerContext } from '../context.js';
import { withJobLock } from './job-lock.js';

/**
 * Settlement generation (plan §41).
 *
 * The documented sequence:
 *   1. acquire a restaurant-period lock
 *   2. find completed eligible orders not already included elsewhere
 *   3. load immutable commission snapshots
 *   4. load approved adjustments
 *   5. create settlement and lines
 *   6. validate totals
 *   7. store DRAFT
 *   8. Finance reviews during early launch
 *   9. issue statement
 *  10. send notification
 *
 * Steps 8–9 are deliberately manual: this job stops at DRAFT so Finance reviews
 * before a restaurant is billed. The unique index on (restaurant, period) means
 * a retried worker cannot produce a second statement even if the lock is lost.
 */

export interface SettlementGenerationResult {
  readonly restaurantsProcessed: number;
  readonly settlementsCreated: number;
  readonly settlementsSkipped: number;
  readonly errors: { restaurantId: string; message: string }[];
}

export async function runSettlementGeneration(
  ctx: WorkerContext,
  options: { now?: Date } = {},
): Promise<SettlementGenerationResult> {
  const now = options.now ?? new Date();

  const result: SettlementGenerationResult = {
    restaurantsProcessed: 0,
    settlementsCreated: 0,
    settlementsSkipped: 0,
    errors: [],
  };

  // A cluster-wide lock so two worker replicas do not both walk the list
  // (plan §94). Database uniqueness remains the final protection.
  const ran = await withJobLock(ctx, 'settlement_generation', 15 * 60_000, async () => {
    const activeRestaurants = await ctx.db
      .select({
        id: restaurants.id,
        displayName: restaurants.displayName,
        settlementPolicy: restaurantCommissionConfigs.settlementPolicy,
        paymentTermDays: restaurantCommissionConfigs.paymentTermDays,
      })
      .from(restaurants)
      .innerJoin(
        restaurantCommissionConfigs,
        and(
          eq(restaurantCommissionConfigs.restaurantId, restaurants.id),
          isNull(restaurantCommissionConfigs.effectiveTo),
        ),
      )
      .where(and(eq(restaurants.onboardingStatus, 'APPROVED'), isNull(restaurants.deletedAt)));

    for (const restaurant of activeRestaurants) {
      (result as { restaurantsProcessed: number }).restaurantsProcessed += 1;
      try {
        const created = await generateForRestaurant(ctx, {
          restaurantId: restaurant.id,
          policy: restaurant.settlementPolicy as SettlementPolicy,
          paymentTermDays: restaurant.paymentTermDays,
          now,
        });
        if (created) (result as { settlementsCreated: number }).settlementsCreated += 1;
        else (result as { settlementsSkipped: number }).settlementsSkipped += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push({ restaurantId: restaurant.id, message });
        ctx.logger.error(
          { event: 'settlement.generation_failed', restaurantId: restaurant.id, err: message },
          'Settlement generation failed for restaurant',
        );
      }
    }
  });

  if (!ran) {
    ctx.logger.info(
      { event: 'settlement.generation_skipped' },
      'Settlement generation skipped: another worker holds the lock',
    );
  }

  return result;
}

async function generateForRestaurant(
  ctx: WorkerContext,
  params: {
    restaurantId: string;
    policy: SettlementPolicy;
    paymentTermDays: number;
    now: Date;
  },
): Promise<boolean> {
  // Settle the period that has just closed, never the one still running.
  const period: SettlementPeriod = previousPeriod(params.now, params.policy);

  return ctx.db.transaction(async (tx) => {
    // 2. Completed orders in the window that no settlement has claimed.
    //    Membership is decided by completed_at (plan §102).
    const eligible = await tx
      .select({
        id: orders.id,
        customerTotalIqd: orders.customerTotalIqd,
        commissionBaseIqd: orders.commissionBaseIqd,
        commissionFlatIqdSnapshot: orders.commissionFlatIqdSnapshot,
        // 3. The immutable snapshot — never the restaurant's current fee.
        commissionAmountIqd: orders.commissionAmountIqd,
        completedAt: orders.completedAt,
      })
      .from(orders)
      .where(
        and(
          eq(orders.restaurantId, params.restaurantId),
          eq(orders.status, 'COMPLETED'),
          gte(orders.completedAt, period.start),
          lt(orders.completedAt, period.end),
          // The unique index on settlement_lines.order_id is the hard guarantee;
          // this subquery keeps the happy path from even attempting a duplicate.
          notInArray(
            orders.id,
            tx.select({ id: settlementLines.orderId }).from(settlementLines),
          ),
        ),
      );

    if (eligible.length === 0) return false;

    // 4. Approved adjustments not yet attached to a statement.
    const adjustments = await tx
      .select({
        id: settlementAdjustments.id,
        amountIqd: settlementAdjustments.amountIqd,
      })
      .from(settlementAdjustments)
      .where(
        and(
          eq(settlementAdjustments.restaurantId, params.restaurantId),
          isNull(settlementAdjustments.settlementId),
        ),
      );

    const grossSales = addIqd(...eligible.map((o) => iqd(o.customerTotalIqd)));
    const commissionBaseTotal = addIqd(...eligible.map((o) => iqd(o.commissionBaseIqd)));
    const commissionTotal = addIqd(...eligible.map((o) => iqd(o.commissionAmountIqd)));
    const adjustmentsTotal: Iqd =
      adjustments.length > 0 ? addIqd(...adjustments.map((a) => iqd(a.amountIqd))) : iqd(0);
    const amountDue = iqd(commissionTotal + adjustmentsTotal);

    // 6. Validate before writing: a statement whose parts do not add up must
    //    never reach a restaurant (plan §95).
    const check = reconcileSettlementTotals({
      lineCommissionTotalIqd: commissionTotal,
      adjustmentsTotalIqd: adjustmentsTotal,
      amountDueIqd: amountDue,
    });
    if (!check.balanced) {
      throw new Error(`Settlement totals do not reconcile: ${check.detail}`);
    }

    const settlementId = uuidv7();

    // 5 & 7. Create the statement as DRAFT for Finance to review.
    await tx.insert(settlements).values({
      id: settlementId,
      restaurantId: params.restaurantId,
      settlementPolicy: params.policy,
      periodStart: period.start,
      periodEnd: period.end,
      status: 'DRAFT',
      orderCount: eligible.length,
      grossSalesIqd: grossSales,
      commissionBaseTotalIqd: commissionBaseTotal,
      commissionTotalIqd: commissionTotal,
      adjustmentsTotalIqd: adjustmentsTotal,
      amountDueIqd: amountDue,
      amountPaidIqd: 0,
      dueDate: dueDateFor(params.now, params.paymentTermDays),
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

    if (adjustments.length > 0) {
      await tx
        .update(settlementAdjustments)
        .set({ settlementId })
        .where(
          inArray(
            settlementAdjustments.id,
            adjustments.map((a) => a.id),
          ),
        );
    }

    await writeAudit(tx, {
      actorUserId: null,
      actorRole: 'SYSTEM',
      action: AUDIT_ACTIONS.SETTLEMENT_GENERATE,
      entityType: 'settlement',
      entityId: settlementId,
      after: {
        restaurantId: params.restaurantId,
        period: period.label,
        orderCount: eligible.length,
        amountDueIqd: amountDue,
      },
    });

    ctx.logger.info(
      {
        event: 'settlement.generated',
        settlementId,
        restaurantId: params.restaurantId,
        period: period.label,
        orderCount: eligible.length,
        amountDueIqd: amountDue,
      },
      'Settlement draft generated',
    );

    return true;
  });
}

/**
 * Mark issued statements overdue once their due date passes (plan §44).
 *
 * Deliberately does NOT suspend the restaurant: "Automatic restaurant suspension
 * is not recommended by default; Operations/Finance should make a controlled
 * decision."
 */
export async function runOverdueEvaluation(ctx: WorkerContext): Promise<number> {
  const now = new Date();

  const overdue = await ctx.db
    .update(settlements)
    .set({ status: 'OVERDUE', updatedAt: now })
    .where(
      and(
        sql`${settlements.status} IN ('ISSUED', 'PARTIALLY_PAID')`,
        lt(settlements.dueDate, now),
      ),
    )
    .returning({
      id: settlements.id,
      restaurantId: settlements.restaurantId,
      amountDueIqd: settlements.amountDueIqd,
      amountPaidIqd: settlements.amountPaidIqd,
      periodStart: settlements.periodStart,
      periodEnd: settlements.periodEnd,
      dueDate: settlements.dueDate,
    });

  for (const settlement of overdue) {
    await ctx.db.transaction(async (tx) => {
      await enqueueOutboxEvent(tx, {
        eventType: EVENT_TYPES.SETTLEMENT_OVERDUE,
        aggregateType: 'settlement',
        aggregateId: settlement.id,
        payload: {
          settlementId: settlement.id,
          restaurantId: settlement.restaurantId,
          periodStart: settlement.periodStart.toISOString(),
          periodEnd: settlement.periodEnd.toISOString(),
          amountDueIqd: settlement.amountDueIqd,
          amountPaidIqd: settlement.amountPaidIqd,
          dueDate: settlement.dueDate?.toISOString() ?? null,
        },
      });
    });
  }

  if (overdue.length > 0) {
    ctx.logger.warn(
      { event: 'settlement.overdue_marked', count: overdue.length },
      'Settlements became overdue',
    );
  }

  return overdue.length;
}
