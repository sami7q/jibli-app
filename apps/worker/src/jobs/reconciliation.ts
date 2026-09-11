import { and, eq, gte, lt, sql } from 'drizzle-orm';
import {
  businessDate,
  reconcileCommissionAccruals,
  reconcileDriverCash,
  startOfBusinessDay,
  type ReconciliationResult,
} from '@jibli/domain';
import {
  driverCashEvents,
  ledgerEntries,
  orders,
  reconciliationRuns,
  uuidv7,
} from '@jibli/db';
import type { WorkerContext } from '../context.js';
import { withJobLock } from './job-lock.js';

/**
 * Daily financial reconciliation (plan §95, §96).
 *
 * Invariants checked:
 *   completed order commission snapshots = commission-accrual ledger entries
 *   completed COD orders                = driver ORDER_CASH_COLLECTED events
 *
 * "Automated reconciliation may identify a problem but should not silently
 * rewrite financial history." Nothing in this job mutates a financial record: it
 * records the check and raises an alert.
 */

export interface ReconciliationSummary {
  readonly businessDate: string;
  readonly checks: ReconciliationResult[];
  readonly allBalanced: boolean;
}

export async function runDailyReconciliation(
  ctx: WorkerContext,
  options: { forDate?: Date } = {},
): Promise<ReconciliationSummary | null> {
  // Reconcile yesterday: today's business day is still accumulating orders.
  const target = options.forDate ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dayStart = startOfBusinessDay(target, ctx.env.BUSINESS_TIMEZONE);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const dateLabel = businessDate(target, ctx.env.BUSINESS_TIMEZONE);

  let summary: ReconciliationSummary | null = null;

  await withJobLock(ctx, `reconciliation:${dateLabel}`, 10 * 60_000, async () => {
    const checks: ReconciliationResult[] = [];

    // ── Commission accrual vs order snapshots ────────────────────────────
    const [orderTotals] = await ctx.db
      .select({
        count: sql<number>`COUNT(*)`,
        commissionTotal: sql<number>`COALESCE(SUM(${orders.commissionAmountIqd}), 0)`,
      })
      .from(orders)
      .where(
        and(
          eq(orders.status, 'COMPLETED'),
          gte(orders.completedAt, dayStart),
          lt(orders.completedAt, dayEnd),
        ),
      );

    const [accrualTotals] = await ctx.db
      .select({
        count: sql<number>`COUNT(*)`,
        total: sql<number>`COALESCE(SUM(${ledgerEntries.amountIqd}), 0)`,
      })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.entryType, 'COMMISSION_ACCRUED'),
          gte(ledgerEntries.effectiveAt, dayStart),
          lt(ledgerEntries.effectiveAt, dayEnd),
        ),
      );

    checks.push(
      reconcileCommissionAccruals({
        orderCommissionTotalIqd: Number(orderTotals?.commissionTotal ?? 0),
        orderCount: Number(orderTotals?.count ?? 0),
        accrualTotalIqd: Number(accrualTotals?.total ?? 0),
        accrualCount: Number(accrualTotals?.count ?? 0),
      }),
    );

    // ── COD orders vs driver cash collected ─────────────────────────────
    const [codTotals] = await ctx.db
      .select({
        count: sql<number>`COUNT(*)`,
        total: sql<number>`COALESCE(SUM(${orders.customerTotalIqd}), 0)`,
      })
      .from(orders)
      .where(
        and(
          eq(orders.status, 'COMPLETED'),
          eq(orders.paymentStatus, 'PAID_CASH'),
          gte(orders.completedAt, dayStart),
          lt(orders.completedAt, dayEnd),
        ),
      );

    const [cashTotals] = await ctx.db
      .select({
        count: sql<number>`COUNT(*)`,
        total: sql<number>`COALESCE(SUM(${driverCashEvents.amountIqd}), 0)`,
      })
      .from(driverCashEvents)
      .where(
        and(
          eq(driverCashEvents.type, 'ORDER_CASH_COLLECTED'),
          gte(driverCashEvents.createdAt, dayStart),
          lt(driverCashEvents.createdAt, dayEnd),
        ),
      );

    const cashCheck = reconcileDriverCash({
      completedCodOrderTotalIqd: Number(codTotals?.total ?? 0),
      completedCodOrderCount: Number(codTotals?.count ?? 0),
      collectedEventTotalIqd: Number(cashTotals?.total ?? 0),
      collectedEventCount: Number(cashTotals?.count ?? 0),
    });

    checks.push({
      checkName: 'cod_orders_match_driver_cash',
      balanced: cashCheck.balanced,
      expectedIqd: Number(codTotals?.total ?? 0) as never,
      actualIqd: Number(cashTotals?.total ?? 0) as never,
      varianceIqd: cashCheck.amountVarianceIqd,
      detail: cashCheck.detail,
    });

    // Record every run, passing or failing: a missing result is itself a signal.
    for (const check of checks) {
      await ctx.db
        .insert(reconciliationRuns)
        .values({
          id: uuidv7(),
          checkName: check.checkName,
          businessDate: dateLabel,
          passed: check.balanced ? 'PASS' : 'FAIL',
          expectedValue: check.expectedIqd,
          actualValue: check.actualIqd,
          varianceIqd: check.varianceIqd,
          detailsJson: { detail: check.detail },
        })
        .onConflictDoUpdate({
          target: [reconciliationRuns.checkName, reconciliationRuns.businessDate],
          set: {
            passed: check.balanced ? 'PASS' : 'FAIL',
            expectedValue: check.expectedIqd,
            actualValue: check.actualIqd,
            varianceIqd: check.varianceIqd,
            detailsJson: { detail: check.detail },
          },
        });

      if (!check.balanced) {
        // This is an alertable condition with an owner and a runbook (plan §91).
        ctx.logger.error(
          {
            event: 'reconciliation.mismatch',
            check: check.checkName,
            businessDate: dateLabel,
            expectedIqd: check.expectedIqd,
            actualIqd: check.actualIqd,
            varianceIqd: check.varianceIqd,
            detail: check.detail,
          },
          'Financial reconciliation mismatch — finance reports must not be trusted until resolved',
        );
      }
    }

    summary = {
      businessDate: dateLabel,
      checks,
      allBalanced: checks.every((c) => c.balanced),
    };

    ctx.logger.info(
      {
        event: 'reconciliation.completed',
        businessDate: dateLabel,
        balanced: summary.allBalanced,
      },
      'Daily reconciliation completed',
    );
  });

  return summary;
}

/**
 * Geography integrity checks (plan §97).
 *
 * "It reports inconsistencies; it does not silently move restaurants or
 * customers between cities."
 */
export async function runGeographyIntegrityCheck(ctx: WorkerContext): Promise<string[]> {
  const problems: string[] = [];
  const { cities, governorates, restaurantBranches, users } = await import('@jibli/db');

  const orphanCities = await ctx.db
    .select({ id: cities.id, code: cities.code })
    .from(cities)
    .leftJoin(governorates, eq(cities.governorateId, governorates.id))
    .where(sql`${governorates.id} IS NULL`);

  for (const city of orphanCities) {
    problems.push(`City ${city.code} references a governorate that does not exist`);
  }

  // A branch whose city and governorate disagree. The composite foreign key
  // added in migration 0002 makes this unrepresentable going forward; the check
  // remains so a pre-migration row cannot hide.
  const mismatchedBranches = await ctx.db
    .select({ id: restaurantBranches.id })
    .from(restaurantBranches)
    .innerJoin(cities, eq(restaurantBranches.cityId, cities.id))
    .where(sql`${cities.governorateId} <> ${restaurantBranches.governorateId}`);

  for (const branch of mismatchedBranches) {
    problems.push(`Branch ${branch.id} has a city/governorate mismatch`);
  }

  const mismatchedProfiles = await ctx.db
    .select({ id: users.id })
    .from(users)
    .innerJoin(cities, eq(users.profileCityId, cities.id))
    .where(sql`${cities.governorateId} <> ${users.profileGovernorateId}`);

  for (const user of mismatchedProfiles) {
    problems.push(`User ${user.id} has a profile city/governorate mismatch`);
  }

  if (problems.length > 0) {
    ctx.logger.error(
      { event: 'geography.integrity_failed', problems },
      'Geography integrity check found inconsistencies',
    );
  }

  return problems;
}
