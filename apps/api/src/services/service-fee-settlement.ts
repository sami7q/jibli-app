import { eq, sql } from 'drizzle-orm';
import { appendLedgerEntry } from '@jibli/domain';
import {
  orders,
  settlementAdjustments,
  settlementLines,
  settlements,
  uuidv7,
  type Transaction,
} from '@jibli/db';

/**
 * Put the orders' service fees on the statement that settles them.
 *
 * Orders are paid in cash to the shop's own courier, so the platform service
 * fee the customer paid is sitting at the shop exactly like the commission is.
 * It used to be recorded only as revenue (`SERVICE_FEE_REVENUE`), never as
 * money owed, so no statement asked for it and «جمع الأرباح» collected the
 * commission alone.
 *
 * It rides on the statement as one positive adjustment rather than inside the
 * lines: a line's commission is the frozen per-order commission (ADR 0006), and
 * the reconciliation rule — due = lines + adjustments — keeps holding without
 * teaching anything else about a new kind of total. The ledger gets the
 * matching `COMMISSION_DEBIT`, the same entry any positive adjustment writes,
 * so the restaurant's balance returns to zero when the statement is paid.
 *
 * Idempotent per statement: the key is the settlement id, so issuing a draft
 * that was already collected, or retrying a request, never adds it twice.
 *
 * Returns the amount added (0 when there was nothing to add).
 */
export async function attachServiceFees(
  tx: Transaction,
  params: { settlementId: string; restaurantId: string; approvedBy: string },
): Promise<number> {
  const idempotencyKey = `service-fee:${params.settlementId}`;

  const [existing] = await tx
    .select({ id: settlementAdjustments.id })
    .from(settlementAdjustments)
    .where(eq(settlementAdjustments.idempotencyKey, idempotencyKey))
    .limit(1);
  if (existing) return 0;

  const [totals] = await tx
    .select({
      fee: sql<number>`COALESCE(SUM(${orders.platformServiceFeeIqd}), 0)`,
      orderCount: sql<number>`COUNT(*) FILTER (WHERE ${orders.platformServiceFeeIqd} > 0)`,
    })
    .from(settlementLines)
    .innerJoin(orders, eq(orders.id, settlementLines.orderId))
    .where(eq(settlementLines.settlementId, params.settlementId));

  const fee = Number(totals?.fee ?? 0);
  if (fee <= 0) return 0;

  const adjustmentId = uuidv7();
  await tx.insert(settlementAdjustments).values({
    id: adjustmentId,
    settlementId: params.settlementId,
    restaurantId: params.restaurantId,
    amountIqd: fee,
    reason: `رسوم الخدمة عن ${Number(totals?.orderCount ?? 0)} طلباً`,
    approvedBy: params.approvedBy,
    idempotencyKey,
  });

  await tx
    .update(settlements)
    .set({
      adjustmentsTotalIqd: sql`${settlements.adjustmentsTotalIqd} + ${fee}`,
      amountDueIqd: sql`${settlements.amountDueIqd} + ${fee}`,
      updatedAt: new Date(),
    })
    .where(eq(settlements.id, params.settlementId));

  await appendLedgerEntry(tx, {
    restaurantId: params.restaurantId,
    settlementId: params.settlementId,
    entryType: 'COMMISSION_DEBIT',
    amountIqd: fee,
    effectiveAt: new Date(),
    idempotencyKey: `adjustment:${adjustmentId}`,
    metadata: { reason: 'SERVICE_FEE' },
  });

  return fee;
}
