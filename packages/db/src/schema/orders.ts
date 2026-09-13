import { relations } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import type {
  ActorType,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
} from '@jibli/contracts';
import {
  createdAt,
  fk,
  money,
  primaryId,
  updatedAt,
  utcTimestamp,
  version,
} from './_shared.js';
import { menuItems, modifiers } from './catalog.js';
import { users, userAddresses } from './identity.js';
import { restaurantBranches, restaurants } from './restaurants.js';

/**
 * Orders (plan §25–§27).
 *
 * Everything a statement, dispute or report needs is snapshotted onto the order
 * at placement. Editing a menu, a commission rate or a customer profile later
 * cannot change what this order was.
 */

export const orders = pgTable(
  'orders',
  {
    id: primaryId(),
    /** Short human-facing number, e.g. JB12456 in the designs. */
    publicOrderNumber: text('public_order_number').notNull(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'restrict' }),
    branchId: fk('branch_id')
      .notNull()
      .references(() => restaurantBranches.id, { onDelete: 'restrict' }),
    addressId: fk('address_id').references(() => userAddresses.id, { onDelete: 'set null' }),

    status: text('status').$type<OrderStatus>().notNull().default('PLACED'),
    paymentMethod: text('payment_method')
      .$type<PaymentMethod>()
      .notNull()
      .default('CASH_ON_DELIVERY'),
    paymentStatus: text('payment_status').$type<PaymentStatus>().notNull().default('CASH_EXPECTED'),
    currency: text('currency').notNull().default('IQD'),

    // ── Money snapshot (plan §25) ────────────────────────────────────────────
    itemsSubtotalIqd: money('items_subtotal_iqd').notNull(),
    deliveryFeeIqd: money('delivery_fee_iqd').notNull().default(0),
    platformServiceFeeIqd: money('platform_service_fee_iqd').notNull().default(0),
    discountTotalIqd: money('discount_total_iqd').notNull().default(0),
    restaurantFundedDiscountIqd: money('restaurant_funded_discount_iqd').notNull().default(0),
    platformFundedDiscountIqd: money('platform_funded_discount_iqd').notNull().default(0),
    customerTotalIqd: money('customer_total_iqd').notNull(),

    // ── Commission snapshot (plan §24) ───────────────────────────────────────
    commissionBaseIqd: money('commission_base_iqd').notNull(),
    /** Frozen flat fee. A later change to the fee cannot rewrite this order. */
    commissionFlatIqdSnapshot: money('commission_flat_iqd_snapshot').notNull(),
    commissionAmountIqd: money('commission_amount_iqd').notNull(),
    restaurantNetSnapshotIqd: money('restaurant_net_snapshot_iqd').notNull(),

    // ── Fulfilment snapshots ─────────────────────────────────────────────────
    customerNameSnapshot: text('customer_name_snapshot').notNull(),
    customerPhoneSnapshot: text('customer_phone_snapshot').notNull(),
    deliveryAddressSnapshotJson: jsonb('delivery_address_snapshot_json')
      .$type<Record<string, unknown>>()
      .notNull(),
    restaurantLocationSnapshotJson: jsonb('restaurant_location_snapshot_json')
      .$type<Record<string, unknown>>()
      .notNull(),
    customerNotes: text('customer_notes'),

    /** Hashed delivery PIN (plan §52). Never stored or logged in the clear. */
    deliveryPinHash: text('delivery_pin_hash'),
    deliveryPinAttempts: integer('delivery_pin_attempts').notNull().default(0),

    estimatedPreparationMinutes: integer('estimated_preparation_minutes'),

    placedAt: utcTimestamp('placed_at').notNull().defaultNow(),
    acceptedAt: utcTimestamp('accepted_at'),
    readyAt: utcTimestamp('ready_at'),
    outForDeliveryAt: utcTimestamp('out_for_delivery_at'),
    deliveredAt: utcTimestamp('delivered_at'),
    /** Settlement membership is based on completed_at (plan §102). */
    completedAt: utcTimestamp('completed_at'),
    cancelledAt: utcTimestamp('cancelled_at'),
    cancellationReason: text('cancellation_reason'),
    rejectionReason: text('rejection_reason'),

    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('orders_public_number_key').on(table.publicOrderNumber),
    // Plan §98 index set.
    index('orders_restaurant_status_idx').on(table.restaurantId, table.status, table.createdAt),
    index('orders_user_idx').on(table.userId, table.createdAt),
    index('orders_branch_completed_idx').on(table.branchId, table.completedAt),
    index('orders_status_idx').on(table.status, table.placedAt),
    /*
     * Dashboard aggregates (migration 0004). The partial predicate lives in the
     * SQL migration, which is the authority; these entries exist so the schema
     * lists every index that exists rather than a subset, and so a future
     * drizzle diff does not propose dropping them.
     */
    index('orders_restaurant_completed_idx').on(table.restaurantId, table.completedAt),
    index('orders_completed_at_idx').on(table.completedAt),
    index('orders_placed_at_idx').on(table.placedAt),
    index('orders_restaurant_placed_idx').on(table.restaurantId, table.placedAt),
  ],
);

/** Immutable line snapshot — name and price as they were at placement (plan §27). */
export const orderItems = pgTable(
  'order_items',
  {
    id: primaryId(),
    orderId: fk('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** Reference kept for reorder and analytics; the snapshot is what counts. */
    menuItemId: fk('menu_item_id').references(() => menuItems.id, { onDelete: 'set null' }),
    nameArSnapshot: text('name_ar_snapshot').notNull(),
    unitPriceIqdSnapshot: money('unit_price_iqd_snapshot').notNull(),
    costPriceIqdSnapshot: money('cost_price_iqd_snapshot'),
    quantity: integer('quantity').notNull(),
    /** (unit + modifiers) × quantity. */
    lineTotalIqd: money('line_total_iqd').notNull(),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (table) => [
    index('order_items_order_idx').on(table.orderId),
    // Best-seller grouping and per-item sales history (migration 0004).
    index('order_items_menu_item_idx').on(table.menuItemId),
  ],
);

export const orderItemModifiers = pgTable(
  'order_item_modifiers',
  {
    id: primaryId(),
    orderItemId: fk('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'cascade' }),
    modifierId: fk('modifier_id').references(() => modifiers.id, { onDelete: 'set null' }),
    groupNameArSnapshot: text('group_name_ar_snapshot').notNull(),
    nameArSnapshot: text('name_ar_snapshot').notNull(),
    priceIqdSnapshot: money('price_iqd_snapshot').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [index('order_item_modifiers_item_idx').on(table.orderItemId)],
);

/** Plan §103: every transition is recorded, with who caused it. */
export const orderStatusHistory = pgTable(
  'order_status_history',
  {
    id: primaryId(),
    orderId: fk('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status').$type<OrderStatus | null>(),
    toStatus: text('to_status').$type<OrderStatus>().notNull(),
    actorType: text('actor_type').$type<ActorType>().notNull(),
    actorUserId: fk('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    reason: text('reason'),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (table) => [index('order_status_history_order_idx').on(table.orderId, table.createdAt)],
);

/**
 * Idempotency records (plan §28).
 *
 * A retry after a timeout returns the original result instead of creating a
 * second order, payment or cash event.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: primaryId(),
    /** Client-supplied key, unique within its scope. */
    key: text('key').notNull(),
    /** e.g. place_order, record_payment, confirm_delivery. */
    scope: text('scope').notNull(),
    userId: fk('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Hash of the request body: the same key with a different payload is a bug. */
    requestHash: text('request_hash').notNull(),
    /** Serialized successful response, replayed verbatim on retry. */
    responseJson: jsonb('response_json').$type<Record<string, unknown>>(),
    resultEntityId: text('result_entity_id'),
    status: text('status').notNull().default('IN_PROGRESS'),
    expiresAt: utcTimestamp('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('idempotency_keys_scope_key').on(table.scope, table.key),
    index('idempotency_keys_expiry_idx').on(table.expiresAt),
  ],
);

/** Server-backed cart (plan §21). Never a financial record. */
export const carts = pgTable(
  'carts',
  {
    id: primaryId(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Release 1 allows one restaurant per cart. */
    restaurantId: fk('restaurant_id').references(() => restaurants.id, { onDelete: 'cascade' }),
    branchId: fk('branch_id').references(() => restaurantBranches.id, { onDelete: 'cascade' }),
    /** Menu version last seen, used only for UX hints (plan §116). */
    menuVersionSeen: integer('menu_version_seen'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('carts_user_key').on(table.userId)],
);

export const cartItems = pgTable(
  'cart_items',
  {
    id: primaryId(),
    cartId: fk('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    menuItemId: fk('menu_item_id')
      .notNull()
      .references(() => menuItems.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull().default(1),
    /** Selected modifier IDs; prices are always recomputed server-side. */
    modifierIds: jsonb('modifier_ids').$type<string[]>().notNull().default([]),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('cart_items_cart_idx').on(table.cartId)],
);

/** Customer reviews (plan §57): one per completed order. */
export const orderReviews = pgTable(
  'order_reviews',
  {
    id: primaryId(),
    orderId: fk('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    isHidden: boolean('is_hidden').notNull().default(false),
    moderatedBy: fk('moderated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('order_reviews_order_key').on(table.orderId),
    index('order_reviews_restaurant_idx').on(table.restaurantId, table.createdAt),
  ],
);

export const customerFavorites = pgTable(
  'customer_favorites',
  {
    id: primaryId(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('customer_favorites_unique').on(table.userId, table.restaurantId)],
);

export const ordersRelations = relations(orders, ({ many, one }) => ({
  items: many(orderItems),
  statusHistory: many(orderStatusHistory),
  customer: one(users, { fields: [orders.userId], references: [users.id] }),
  restaurant: one(restaurants, { fields: [orders.restaurantId], references: [restaurants.id] }),
  branch: one(restaurantBranches, {
    fields: [orders.branchId],
    references: [restaurantBranches.id],
  }),
}));

export const orderItemsRelations = relations(orderItems, ({ one, many }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  modifiers: many(orderItemModifiers),
}));

export type OrderRow = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type OrderItemRow = typeof orderItems.$inferSelect;
export type OrderStatusHistoryRow = typeof orderStatusHistory.$inferSelect;
export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
export type CartRow = typeof carts.$inferSelect;
