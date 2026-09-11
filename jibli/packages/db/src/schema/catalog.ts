import { relations } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, fk, money, primaryId, updatedAt } from './_shared.js';
import { restaurantBranches, restaurants } from './restaurants.js';

/**
 * Menu domain (plan §19, §20).
 *
 * Menu changes never mutate historical order snapshots — orders copy what they
 * need at placement time (see schema/orders.ts).
 */

export const menuCategories = pgTable(
  'menu_categories',
  {
    id: primaryId(),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    nameAr: text('name_ar').notNull(),
    descriptionAr: text('description_ar'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [index('menu_categories_restaurant_idx').on(table.restaurantId, table.sortOrder)],
);

export const menuItems = pgTable(
  'menu_items',
  {
    id: primaryId(),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    categoryId: fk('category_id')
      .notNull()
      .references(() => menuCategories.id, { onDelete: 'restrict' }),
    nameAr: text('name_ar').notNull(),
    descriptionAr: text('description_ar'),
    /** Integer IQD. The client never sends a trusted price (plan §20). */
    basePriceIqd: money('base_price_iqd').notNull(),
    /** Cost price drives gross margin; visibility is permission-gated (plan §38). */
    costPriceIqd: money('cost_price_iqd'),
    imageAssetId: fk('image_asset_id'),
    sku: text('sku'),

    isActive: boolean('is_active').notNull().default(true),
    /** Day-to-day availability toggle, distinct from deactivating the item. */
    isAvailable: boolean('is_available').notNull().default(true),
    /**
     * Set when inventory drove the item unavailable. Restock may reverse this,
     * but must never reverse a manual staff disable (plan §37).
     */
    unavailableByInventory: boolean('unavailable_by_inventory').notNull().default(false),

    preparationMinutesOverride: integer('preparation_minutes_override'),
    sortOrder: integer('sort_order').notNull().default(0),
    isPopular: boolean('is_popular').notNull().default(false),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    index('menu_items_restaurant_idx').on(table.restaurantId, table.isActive),
    index('menu_items_category_idx').on(table.categoryId, table.sortOrder),
    uniqueIndex('menu_items_sku_key').on(table.restaurantId, table.sku),
  ],
);

/** Plan §20: size, extra cheese, sauce, side dish, drink choice. */
export const modifierGroups = pgTable(
  'modifier_groups',
  {
    id: primaryId(),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    nameAr: text('name_ar').notNull(),
    minSelect: integer('min_select').notNull().default(0),
    maxSelect: integer('max_select').notNull().default(1),
    isRequired: boolean('is_required').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('modifier_groups_restaurant_idx').on(table.restaurantId)],
);

export const modifiers = pgTable(
  'modifiers',
  {
    id: primaryId(),
    groupId: fk('group_id')
      .notNull()
      .references(() => modifierGroups.id, { onDelete: 'cascade' }),
    nameAr: text('name_ar').notNull(),
    /** Per-unit surcharge in IQD; zero for free options. */
    priceIqd: money('price_iqd').notNull().default(0),
    isAvailable: boolean('is_available').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('modifiers_group_idx').on(table.groupId, table.sortOrder)],
);

/** Which groups apply to which item. */
export const itemModifierGroups = pgTable(
  'item_modifier_groups',
  {
    id: primaryId(),
    itemId: fk('item_id')
      .notNull()
      .references(() => menuItems.id, { onDelete: 'cascade' }),
    groupId: fk('group_id')
      .notNull()
      .references(() => modifierGroups.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [uniqueIndex('item_modifier_groups_unique').on(table.itemId, table.groupId)],
);

/** Branch-level availability override, so one branch can run out without hiding the item. */
export const branchItemAvailability = pgTable(
  'branch_item_availability',
  {
    id: primaryId(),
    branchId: fk('branch_id')
      .notNull()
      .references(() => restaurantBranches.id, { onDelete: 'cascade' }),
    itemId: fk('item_id')
      .notNull()
      .references(() => menuItems.id, { onDelete: 'cascade' }),
    isAvailable: boolean('is_available').notNull().default(true),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('branch_item_availability_unique').on(table.branchId, table.itemId)],
);

export const menuCategoriesRelations = relations(menuCategories, ({ many, one }) => ({
  items: many(menuItems),
  restaurant: one(restaurants, {
    fields: [menuCategories.restaurantId],
    references: [restaurants.id],
  }),
}));

export const menuItemsRelations = relations(menuItems, ({ one, many }) => ({
  category: one(menuCategories, {
    fields: [menuItems.categoryId],
    references: [menuCategories.id],
  }),
  modifierGroups: many(itemModifierGroups),
}));

export const modifierGroupsRelations = relations(modifierGroups, ({ many }) => ({
  modifiers: many(modifiers),
}));

export type MenuCategoryRow = typeof menuCategories.$inferSelect;
export type MenuItemRow = typeof menuItems.$inferSelect;
export type ModifierGroupRow = typeof modifierGroups.$inferSelect;
export type ModifierRow = typeof modifiers.$inferSelect;
