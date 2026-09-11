import { relations } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import type {
  ExpenseCategory,
  LedgerDirection,
  LedgerEntryType,
  PaymentRecordMethod,
  SettlementPolicy,
  SettlementStatus,
} from '@jibli/contracts';
import { createdAt, fk, money, primaryId, updatedAt, utcTimestamp } from './_shared.js';
import { users } from './identity.js';
import { orders } from './orders.js';
import { restaurantBranches, restaurants } from './restaurants.js';

/**
 * Platform finance and restaurant management accounting (plan §24, §39–§44).
 *
 * Financial records are append-only in spirit: issued statements, ledger entries
 * and payments are never silently edited. Corrections are compensating entries.
 */

/**
 * Effective-dated commission configuration (plan §24).
 *
 * The current rate is the row whose [effective_from, effective_to) window covers
 * now. Orders snapshot the rate, so changing this never rewrites history.
 */
export const restaurantCommissionConfigs = pgTable(
  'restaurant_commission_configs',
  {
    id: primaryId(),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    /** Basis points: 12% = 1200. Constrained to 0..10000 by a check constraint. */
    commissionRateBps: integer('commission_rate_bps').notNull(),
    settlementPolicy: text('settlement_policy').$type<SettlementPolicy>().notNull().default('HALF_MONTH'),
    /** Days after a statement is issued before it becomes overdue. */
    paymentTermDays: integer('payment_term_days').notNull().default(7),
    effectiveFrom: utcTimestamp('effective_from').notNull(),
    effectiveTo: utcTimestamp('effective_to'),
    createdBy: fk('created_by').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: createdAt(),
  },
  (table) => [
    index('commission_configs_restaurant_idx').on(table.restaurantId, table.effectiveFrom),
  ],
);

/**
 * Settlement statements (plan §40–§42).
 *
 * Periods are half-open [start, end) in Asia/Baghdad, converted to UTC for
 * querying. The unique index is what stops a retried worker from issuing a
 * duplicate statement (plan §41).
 */
export const settlements = pgTable(
  'settlements',
  {
    id: primaryId(),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'restrict' }),
    settlementPolicy: text('settlement_policy').$type<SettlementPolicy>().notNull(),
    /** Inclusive lower bound, UTC. */
    periodStart: utcTimestamp('period_start').notNull(),
    /** Exclusive upper bound, UTC. */
    periodEnd: utcTimestamp('period_end').notNull(),

    status: text('status').$type<SettlementStatus>().notNull().default('DRAFT'),
    orderCount: integer('order_count').notNull().default(0),
    grossSalesIqd: money('gross_sales_iqd').notNull().default(0),
    commissionBaseTotalIqd: money('commission_base_total_iqd').notNull().default(0),
    commissionTotalIqd: money('commission_total_iqd').notNull().default(0),
    adjustmentsTotalIqd: money('adjustments_total_iqd').notNull().default(0),
    amountDueIqd: money('amount_due_iqd').notNull().default(0),
    amountPaidIqd: money('amount_paid_iqd').notNull().default(0),

    dueDate: utcTimestamp('due_date'),
    issuedAt: utcTimestamp('issued_at'),
    issuedBy: fk('issued_by').references(() => users.id, { onDelete: 'set null' }),
    paidAt: utcTimestamp('paid_at'),
    voidedAt: utcTimestamp('voided_at'),
    voidedBy: fk('voided_by').references(() => users.id, { onDelete: 'set null' }),
    voidReason: text('void_reason'),
    disputeReason: text('dispute_reason'),
    disputedAt: utcTimestamp('disputed_at'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Plan §99: "unique settlement per restaurant/period".
    uniqueIndex('settlements_restaurant_period_key').on(
      table.restaurantId,
      table.periodStart,
      table.periodEnd,
    ),
    index('settlements_restaurant_idx').on(table.restaurantId, table.periodStart),
    index('settlements_status_idx').on(table.status, table.dueDate),
  ],
);

/**
 * One line per order included in a statement.
 *
 * The unique index on order_id is what guarantees an order can never be settled
 * twice (plan §225).
 */
export const settlementLines = pgTable(
  'settlement_lines',
  {
    id: primaryId(),
    settlementId: fk('settlement_id')
      .notNull()
      .references(() => settlements.id, { onDelete: 'cascade' }),
    orderId: fk('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    /** Copied from the order's immutable snapshot, never recomputed from current config. */
    commissionBaseIqd: money('commission_base_iqd').notNull(),
    commissionRateBpsSnapshot: integer('commission_rate_bps_snapshot').notNull(),
    commissionAmountIqd: money('commission_amount_iqd').notNull(),
    orderCompletedAt: utcTimestamp('order_completed_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('settlement_lines_order_key').on(table.orderId),
    index('settlement_lines_settlement_idx').on(table.settlementId),
  ],
);

/** Credits and debits applied to a statement (plan §44). */
export const settlementAdjustments = pgTable(
  'settlement_adjustments',
  {
    id: primaryId(),
    settlementId: fk('settlement_id').references(() => settlements.id, { onDelete: 'set null' }),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'restrict' }),
    /** Negative reduces what the restaurant owes; positive increases it. */
    amountIqd: money('amount_iqd').notNull(),
    reason: text('reason').notNull(),
    approvedBy: fk('approved_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Set when this adjustment reverses another. */
    reversesAdjustmentId: fk('reverses_adjustment_id'),
    idempotencyKey: text('idempotency_key'),
    createdAt: createdAt(),
  },
  (table) => [
    index('settlement_adjustments_settlement_idx').on(table.settlementId),
    index('settlement_adjustments_restaurant_idx').on(table.restaurantId, table.createdAt),
    uniqueIndex('settlement_adjustments_idempotency_key').on(table.idempotencyKey),
  ],
);

/** Payments are immutable records; a mistake is corrected by a reversal (plan §42). */
export const settlementPayments = pgTable(
  'settlement_payments',
  {
    id: primaryId(),
    settlementId: fk('settlement_id')
      .notNull()
      .references(() => settlements.id, { onDelete: 'restrict' }),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'restrict' }),
    amountIqd: money('amount_iqd').notNull(),
    method: text('method').$type<PaymentRecordMethod>().notNull(),
    reference: text('reference'),
    receiptAssetId: fk('receipt_asset_id'),
    paidAt: utcTimestamp('paid_at').notNull(),
    recordedBy: fk('recorded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    note: text('note'),
    reversesPaymentId: fk('reverses_payment_id'),
    idempotencyKey: text('idempotency_key'),
    createdAt: createdAt(),
  },
  (table) => [
    index('settlement_payments_settlement_idx').on(table.settlementId, table.paidAt),
    uniqueIndex('settlement_payments_idempotency_key').on(table.idempotencyKey),
  ],
);

/**
 * Platform operational ledger (plan §43).
 *
 * Balances are derived from these events, not from scattered increment logic.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: primaryId(),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'restrict' }),
    orderId: fk('order_id').references(() => orders.id, { onDelete: 'set null' }),
    settlementId: fk('settlement_id').references(() => settlements.id, { onDelete: 'set null' }),
    entryType: text('entry_type').$type<LedgerEntryType>().notNull(),
    amountIqd: money('amount_iqd').notNull(),
    direction: text('direction').$type<LedgerDirection>().notNull(),
    effectiveAt: utcTimestamp('effective_at').notNull(),
    /** Unique per entry: a retried transaction cannot double-accrue (plan §28). */
    idempotencyKey: text('idempotency_key').notNull(),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('ledger_entries_idempotency_key').on(table.idempotencyKey),
    index('ledger_entries_restaurant_idx').on(table.restaurantId, table.effectiveAt),
    index('ledger_entries_order_idx').on(table.orderId),
  ],
);

/** Restaurant private management accounting (plan §38). */
export const restaurantExpenses = pgTable(
  'restaurant_expenses',
  {
    id: primaryId(),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    branchId: fk('branch_id').references(() => restaurantBranches.id, { onDelete: 'set null' }),
    category: text('category').$type<ExpenseCategory>().notNull(),
    amountIqd: money('amount_iqd').notNull(),
    descriptionAr: text('description_ar'),
    /** Local business date in Asia/Baghdad (YYYY-MM-DD). */
    expenseDate: text('expense_date').notNull(),
    receiptAssetId: fk('receipt_asset_id'),
    createdBy: fk('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('restaurant_expenses_restaurant_idx').on(table.restaurantId, table.expenseDate),
    index('restaurant_expenses_category_idx').on(table.category),
  ],
);

/** Daily reconciliation results (plan §95). A mismatch alerts; it never self-heals. */
export const reconciliationRuns = pgTable(
  'reconciliation_runs',
  {
    id: primaryId(),
    checkName: text('check_name').notNull(),
    /** Business date checked, in Asia/Baghdad. */
    businessDate: text('business_date').notNull(),
    passed: text('passed').notNull(),
    expectedValue: money('expected_value'),
    actualValue: money('actual_value'),
    varianceIqd: money('variance_iqd'),
    detailsJson: jsonb('details_json').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('reconciliation_runs_unique').on(table.checkName, table.businessDate),
    index('reconciliation_runs_date_idx').on(table.businessDate),
  ],
);

export const settlementsRelations = relations(settlements, ({ many, one }) => ({
  lines: many(settlementLines),
  payments: many(settlementPayments),
  adjustments: many(settlementAdjustments),
  restaurant: one(restaurants, {
    fields: [settlements.restaurantId],
    references: [restaurants.id],
  }),
}));

export type SettlementRow = typeof settlements.$inferSelect;
export type SettlementLineRow = typeof settlementLines.$inferSelect;
export type SettlementPaymentRow = typeof settlementPayments.$inferSelect;
export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;
export type RestaurantCommissionConfigRow = typeof restaurantCommissionConfigs.$inferSelect;
export type RestaurantExpenseRow = typeof restaurantExpenses.$inferSelect;
