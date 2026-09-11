import { relations } from 'drizzle-orm';
import { boolean, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import type { InventoryMovementType, InventoryUnit } from '@jibli/contracts';
import {
  createdAt,
  deletedAt,
  fk,
  money,
  primaryId,
  quantity,
  updatedAt,
  utcTimestamp,
  version,
} from './_shared.js';
import { menuItems } from './catalog.js';
import { users } from './identity.js';
import { orders } from './orders.js';
import { restaurantBranches, restaurants } from './restaurants.js';

/**
 * Inventory (plan §34–§37).
 *
 * Quantities are fixed-precision decimals, never floats (plan §101). Every stock
 * change produces a movement row, and finalized movements are never deleted —
 * corrections are compensating movements.
 */

export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: primaryId(),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    branchId: fk('branch_id')
      .notNull()
      .references(() => restaurantBranches.id, { onDelete: 'cascade' }),
    nameAr: text('name_ar').notNull(),
    sku: text('sku'),
    unit: text('unit').$type<InventoryUnit>().notNull().default('PIECE'),

    onHandQuantity: quantity('on_hand_quantity').notNull().default('0'),
    /** Reserved by placed-but-not-yet-consumed orders (plan §36). */
    reservedQuantity: quantity('reserved_quantity').notNull().default('0'),
    lowStockThreshold: quantity('low_stock_threshold'),

    unitCostIqd: money('unit_cost_iqd'),
    isTracked: boolean('is_tracked').notNull().default(true),
    /** Whether stock may go negative; default is no (plan §34). */
    allowNegativeStock: boolean('allow_negative_stock').notNull().default(false),
    /** Debounces repeated low-stock alerts (plan §183). */
    lowStockNotifiedAt: utcTimestamp('low_stock_notified_at'),

    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index('inventory_items_branch_idx').on(table.branchId, table.isTracked),
    // Low-stock panel; partial on a non-null threshold in migration 0004.
    index('inventory_items_low_stock_idx').on(table.restaurantId),
    uniqueIndex('inventory_items_sku_key').on(table.branchId, table.sku),
  ],
);

/**
 * Movement ledger (plan §35). Append-only in spirit: this table records what
 * happened, and the on-hand column is its running total.
 */
export const inventoryMovements = pgTable(
  'inventory_movements',
  {
    id: primaryId(),
    inventoryItemId: fk('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'restrict' }),
    type: text('type').$type<InventoryMovementType>().notNull(),
    /** Signed delta applied to on-hand (or to reserved, for reservation types). */
    quantityDelta: quantity('quantity_delta').notNull(),
    /** On-hand after this movement — makes history auditable without replay. */
    resultingOnHand: quantity('resulting_on_hand').notNull(),
    unitCostIqd: money('unit_cost_iqd'),
    orderId: fk('order_id').references(() => orders.id, { onDelete: 'set null' }),
    reason: text('reason'),
    actorUserId: fk('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Blocks a retried command from applying the same movement twice. */
    idempotencyKey: text('idempotency_key'),
    createdAt: createdAt(),
  },
  (table) => [
    index('inventory_movements_item_idx').on(table.inventoryItemId, table.createdAt),
    index('inventory_movements_order_idx').on(table.orderId),
    uniqueIndex('inventory_movements_idempotency_key').on(table.idempotencyKey),
  ],
);

/** Live reservations, so a released or expired hold can be found (plan §36, §94). */
export const inventoryReservations = pgTable(
  'inventory_reservations',
  {
    id: primaryId(),
    inventoryItemId: fk('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    orderId: fk('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    quantityReserved: quantity('quantity_reserved').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    releasedAt: utcTimestamp('released_at'),
    consumedAt: utcTimestamp('consumed_at'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('inventory_reservations_unique').on(table.orderId, table.inventoryItemId),
    index('inventory_reservations_status_idx').on(table.status, table.createdAt),
  ],
);

/** Recipes (plan §37): which ingredients a menu item consumes. */
export const recipes = pgTable(
  'recipes',
  {
    id: primaryId(),
    menuItemId: fk('menu_item_id')
      .notNull()
      .references(() => menuItems.id, { onDelete: 'cascade' }),
    inventoryItemId: fk('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'restrict' }),
    /** Amount consumed per one unit of the menu item, in the ingredient's unit. */
    quantityPerUnit: quantity('quantity_per_unit').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('recipes_unique').on(table.menuItemId, table.inventoryItemId)],
);

/** Physical stocktakes; the variance becomes an ADJUSTMENT movement. */
export const stocktakes = pgTable(
  'stocktakes',
  {
    id: primaryId(),
    branchId: fk('branch_id')
      .notNull()
      .references(() => restaurantBranches.id, { onDelete: 'cascade' }),
    performedBy: fk('performed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    note: text('note'),
    completedAt: utcTimestamp('completed_at'),
    createdAt: createdAt(),
  },
  (table) => [index('stocktakes_branch_idx').on(table.branchId, table.createdAt)],
);

export const stocktakeLines = pgTable(
  'stocktake_lines',
  {
    id: primaryId(),
    stocktakeId: fk('stocktake_id')
      .notNull()
      .references(() => stocktakes.id, { onDelete: 'cascade' }),
    inventoryItemId: fk('inventory_item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'restrict' }),
    expectedQuantity: quantity('expected_quantity').notNull(),
    countedQuantity: quantity('counted_quantity').notNull(),
    varianceQuantity: quantity('variance_quantity').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('stocktake_lines_stocktake_idx').on(table.stocktakeId)],
);

export const inventoryItemsRelations = relations(inventoryItems, ({ many, one }) => ({
  movements: many(inventoryMovements),
  reservations: many(inventoryReservations),
  branch: one(restaurantBranches, {
    fields: [inventoryItems.branchId],
    references: [restaurantBranches.id],
  }),
}));

export type InventoryItemRow = typeof inventoryItems.$inferSelect;
export type InventoryMovementRow = typeof inventoryMovements.$inferSelect;
export type InventoryReservationRow = typeof inventoryReservations.$inferSelect;
export type RecipeRow = typeof recipes.$inferSelect;
