import {
  AppError,
  ERROR_CODES,
  type LedgerDirection,
  type LedgerEntryType,
  type SettlementStatus,
} from '@jibli/contracts';
import { iqd, type Iqd } from '@jibli/money';
import { ledgerEntries, uuidv7, type DbExecutor } from '@jibli/db';

/**
 * Platform financial ledger (plan §43).
 *
 * "Balances are derived from ledger events or from a reconciled cached balance,
 * not from uncontrolled increment/decrement logic scattered around the
 * codebase."
 *
 * Sign convention: DEBIT increases what the restaurant owes Jibli, CREDIT
 * decreases it. Amounts are always stored positive; direction carries the sign.
 */

/** Which direction each entry type moves the restaurant's balance. */
export const ENTRY_DIRECTION: Record<LedgerEntryType, LedgerDirection> = {
  COMMISSION_ACCRUED: 'DEBIT', // restaurant now owes commission on a completed order
  COMMISSION_PAYMENT: 'CREDIT', // restaurant paid, owes less
  COMMISSION_CREDIT: 'CREDIT', // finance forgave part of the balance
  COMMISSION_DEBIT: 'DEBIT', // finance added a charge
  SERVICE_FEE_REVENUE: 'DEBIT', // platform revenue, tracked but not owed by restaurant
  REVERSAL: 'CREDIT', // undoes a previous entry
};

export interface LedgerEntryInput {
  readonly restaurantId: string;
  readonly entryType: LedgerEntryType;
  readonly amountIqd: number;
  readonly effectiveAt: Date;
  /** Unique per logical event — the DB index makes double-accrual impossible. */
  readonly idempotencyKey: string;
  readonly orderId?: string | null;
  readonly settlementId?: string | null;
  readonly direction?: LedgerDirection;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Append a ledger entry. Takes a transaction: an accrual must commit with the
 * order completion that caused it (plan §53).
 */
export async function appendLedgerEntry(
  tx: DbExecutor,
  input: LedgerEntryInput,
): Promise<string> {
  const amount = iqd(input.amountIqd);
  if (amount < 0) {
    // Sign lives in `direction`; a negative amount would double-encode it and
    // make every SUM() ambiguous.
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      details: { field: 'amountIqd', message: 'Ledger amounts are positive; use direction' },
    });
  }

  const id = uuidv7();
  await tx.insert(ledgerEntries).values({
    id,
    restaurantId: input.restaurantId,
    orderId: input.orderId ?? null,
    settlementId: input.settlementId ?? null,
    entryType: input.entryType,
    amountIqd: amount,
    direction: input.direction ?? ENTRY_DIRECTION[input.entryType],
    effectiveAt: input.effectiveAt,
    idempotencyKey: input.idempotencyKey,
    metadataJson: input.metadata ?? null,
  });
  return id;
}

export interface LedgerRow {
  readonly entryType: LedgerEntryType;
  readonly amountIqd: number;
  readonly direction: LedgerDirection;
}

export interface RestaurantBalance {
  readonly accruedIqd: Iqd;
  readonly paidIqd: Iqd;
  readonly creditsIqd: Iqd;
  readonly debitsIqd: Iqd;
  /** What the restaurant currently owes Jibli. */
  readonly outstandingIqd: Iqd;
  /** Platform revenue recognised, which is not a receivable. */
  readonly serviceFeeRevenueIqd: Iqd;
}

/**
 * Derive a restaurant's balance from its ledger.
 *
 * SERVICE_FEE_REVENUE is tracked separately: it is money the customer paid
 * Jibli, not money the restaurant owes, and mixing the two would overstate
 * receivables — exactly the confusion plan §130 warns about.
 */
export function deriveBalance(rows: readonly LedgerRow[]): RestaurantBalance {
  let accrued = 0;
  let paid = 0;
  let credits = 0;
  let debits = 0;
  let serviceFee = 0;

  for (const row of rows) {
    switch (row.entryType) {
      case 'COMMISSION_ACCRUED':
        accrued += row.amountIqd;
        break;
      case 'COMMISSION_PAYMENT':
        paid += row.amountIqd;
        break;
      case 'COMMISSION_CREDIT':
      case 'REVERSAL':
        credits += row.amountIqd;
        break;
      case 'COMMISSION_DEBIT':
        debits += row.amountIqd;
        break;
      case 'SERVICE_FEE_REVENUE':
        serviceFee += row.amountIqd;
        break;
    }
  }

  return {
    accruedIqd: iqd(accrued),
    paidIqd: iqd(paid),
    creditsIqd: iqd(credits),
    debitsIqd: iqd(debits),
    outstandingIqd: iqd(accrued + debits - paid - credits),
    serviceFeeRevenueIqd: iqd(serviceFee),
  };
}

/**
 * Decide a settlement's status from its amounts (plan §42).
 *
 * Derived rather than set by hand, so "paid" always means the numbers say paid.
 */
export function settlementStatusFromAmounts(params: {
  current: SettlementStatus;
  amountDueIqd: number;
  amountPaidIqd: number;
  dueDate: Date | null;
  now?: Date;
}): SettlementStatus {
  const now = params.now ?? new Date();

  // Terminal and human-owned states are never recomputed.
  if (params.current === 'VOID' || params.current === 'DISPUTED' || params.current === 'DRAFT') {
    return params.current;
  }

  if (params.amountPaidIqd >= params.amountDueIqd && params.amountDueIqd > 0) return 'PAID';
  // A zero-value statement is settled on issue; there is nothing to collect.
  if (params.amountDueIqd === 0) return 'PAID';

  const overdue = params.dueDate !== null && params.dueDate.getTime() < now.getTime();
  if (params.amountPaidIqd > 0) return overdue ? 'OVERDUE' : 'PARTIALLY_PAID';
  return overdue ? 'OVERDUE' : 'ISSUED';
}

/** Guard a payment against over-collection (plan §76). */
export function assertPaymentWithinBalance(params: {
  amountDueIqd: number;
  amountPaidIqd: number;
  newPaymentIqd: number;
}): Iqd {
  const amount = iqd(params.newPaymentIqd);
  if (amount <= 0) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      details: { field: 'amountIqd', message: 'Payment must be positive' },
    });
  }
  const remaining = params.amountDueIqd - params.amountPaidIqd;
  if (amount > remaining) {
    throw new AppError(ERROR_CODES.PAYMENT_EXCEEDS_ALLOWED_BALANCE, {
      details: { remainingIqd: remaining, attemptedIqd: amount },
    });
  }
  return amount;
}

/**
 * Reconciliation invariants (plan §95).
 *
 * "A mismatch creates an alert and blocks blind confidence in finance reports.
 * Automated reconciliation may identify a problem but should not silently
 * rewrite financial history." Nothing here mutates anything.
 */
export interface CommissionReconciliationInput {
  /** Sum of commission_amount_iqd over completed orders in the window. */
  readonly orderCommissionTotalIqd: number;
  readonly orderCount: number;
  /** Sum of COMMISSION_ACCRUED ledger entries in the same window. */
  readonly accrualTotalIqd: number;
  readonly accrualCount: number;
}

export interface ReconciliationResult {
  readonly checkName: string;
  readonly balanced: boolean;
  readonly expectedIqd: Iqd;
  readonly actualIqd: Iqd;
  readonly varianceIqd: Iqd;
  readonly detail: string;
}

export function reconcileCommissionAccruals(
  input: CommissionReconciliationInput,
): ReconciliationResult {
  const variance = iqd(input.orderCommissionTotalIqd - input.accrualTotalIqd);
  const countMatches = input.orderCount === input.accrualCount;
  return {
    checkName: 'commission_accrual_matches_orders',
    balanced: variance === 0 && countMatches,
    expectedIqd: iqd(input.orderCommissionTotalIqd),
    actualIqd: iqd(input.accrualTotalIqd),
    varianceIqd: variance,
    detail: countMatches
      ? `Commission variance ${variance} IQD across ${input.orderCount} orders`
      : `Order count ${input.orderCount} does not match accrual count ${input.accrualCount}`,
  };
}

/**
 * Settlement invariant:
 *   sum(included eligible commission) + approved adjustments = amount due
 */
export function reconcileSettlementTotals(input: {
  lineCommissionTotalIqd: number;
  adjustmentsTotalIqd: number;
  amountDueIqd: number;
}): ReconciliationResult {
  const expected = input.lineCommissionTotalIqd + input.adjustmentsTotalIqd;
  const variance = iqd(expected - input.amountDueIqd);
  return {
    checkName: 'settlement_due_matches_lines',
    balanced: variance === 0,
    expectedIqd: iqd(expected),
    actualIqd: iqd(input.amountDueIqd),
    varianceIqd: variance,
    detail: `Lines ${input.lineCommissionTotalIqd} + adjustments ${input.adjustmentsTotalIqd} vs due ${input.amountDueIqd}`,
  };
}
