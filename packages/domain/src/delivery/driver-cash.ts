import { AppError, ERROR_CODES, type DriverCashEventType } from '@jibli/contracts';
import { addIqd, iqd, type Iqd } from '@jibli/money';

/**
 * Driver cash custody (plan §54, §96).
 *
 *   opening custody
 *   + COD collected
 *   - cash handed over
 *   +/- authorized adjustments
 *   = current custody
 *
 * This is restaurant cash the driver is holding. It is NOT a Jibli commission
 * payment and never touches the platform ledger — conflating the two is the
 * single most expensive mistake this module exists to prevent.
 */

export interface CashEvent {
  readonly type: DriverCashEventType;
  /** Signed: collections positive, handovers negative, adjustments either way. */
  readonly amountIqd: number;
  readonly createdAt: Date;
}

export interface CustodyBalance {
  readonly collectedIqd: Iqd;
  readonly handedOverIqd: Iqd;
  readonly adjustmentsIqd: Iqd;
  readonly currentCustodyIqd: Iqd;
  readonly eventCount: number;
}

/**
 * Fold cash events into a custody balance.
 *
 * Derived from events rather than a stored running total, so a balance can
 * always be re-proved from history (plan §43's principle applied to cash).
 */
export function computeCustody(events: readonly CashEvent[], openingIqd = 0): CustodyBalance {
  let collected = 0;
  let handedOver = 0;
  let adjustments = 0;

  for (const event of events) {
    switch (event.type) {
      case 'ORDER_CASH_COLLECTED':
        if (event.amountIqd < 0) {
          throw new AppError(ERROR_CODES.FINANCIAL_RECONCILIATION_REQUIRED, {
            details: { reason: 'NEGATIVE_COLLECTION', amountIqd: event.amountIqd },
          });
        }
        collected += event.amountIqd;
        break;
      case 'CASH_HANDED_OVER':
        if (event.amountIqd > 0) {
          throw new AppError(ERROR_CODES.FINANCIAL_RECONCILIATION_REQUIRED, {
            details: { reason: 'POSITIVE_HANDOVER', amountIqd: event.amountIqd },
          });
        }
        handedOver += Math.abs(event.amountIqd);
        break;
      case 'CASH_ADJUSTMENT':
        adjustments += event.amountIqd;
        break;
    }
  }

  return {
    collectedIqd: iqd(collected),
    handedOverIqd: iqd(handedOver),
    adjustmentsIqd: iqd(adjustments),
    currentCustodyIqd: iqd(openingIqd + collected - handedOver + adjustments),
    eventCount: events.length,
  };
}

/**
 * Validate a handover before recording it.
 *
 * A driver cannot hand over more than they hold: that would mean either the
 * custody ledger or the cash count is wrong, and both need a human (plan §96).
 */
export function assertHandoverAllowed(custody: CustodyBalance, amountIqd: number): Iqd {
  const amount = iqd(amountIqd);
  if (amount <= 0) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      details: { field: 'amountIqd', message: 'Handover amount must be positive' },
    });
  }
  if (amount > custody.currentCustodyIqd) {
    throw new AppError(ERROR_CODES.FINANCIAL_RECONCILIATION_REQUIRED, {
      details: {
        reason: 'HANDOVER_EXCEEDS_CUSTODY',
        amountIqd: amount,
        currentCustodyIqd: custody.currentCustodyIqd,
      },
    });
  }
  return amount;
}

/**
 * Reconciliation invariant (plan §95):
 *
 *   completed COD orders = driver ORDER_CASH_COLLECTED events
 *
 * A mismatch raises an alert. It never silently rewrites financial history.
 */
export interface CashReconciliationInput {
  readonly completedCodOrderTotalIqd: number;
  readonly completedCodOrderCount: number;
  readonly collectedEventTotalIqd: number;
  readonly collectedEventCount: number;
}

export interface CashReconciliationResult {
  readonly balanced: boolean;
  readonly amountVarianceIqd: Iqd;
  readonly countVariance: number;
  readonly detail: string;
}

export function reconcileDriverCash(input: CashReconciliationInput): CashReconciliationResult {
  const amountVariance = iqd(input.completedCodOrderTotalIqd - input.collectedEventTotalIqd);
  const countVariance = input.completedCodOrderCount - input.collectedEventCount;
  const balanced = amountVariance === 0 && countVariance === 0;

  return {
    balanced,
    amountVarianceIqd: amountVariance,
    countVariance,
    detail: balanced
      ? 'COD orders and driver cash events agree'
      : `COD total ${input.completedCodOrderTotalIqd} vs collected ${input.collectedEventTotalIqd}` +
        ` (${input.completedCodOrderCount} vs ${input.collectedEventCount} events)`,
  };
}

/** Sum a set of custody balances — the restaurant accountant's total. */
export function totalCustody(balances: readonly CustodyBalance[]): Iqd {
  return addIqd(...balances.map((b) => b.currentCustodyIqd));
}
