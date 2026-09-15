import type { MerchantType } from '@jibli/contracts';
import { boolean, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { assets } from './platform.js';
import { createdAt, fk, primaryId, updatedAt, utcTimestamp } from './_shared.js';
import { users } from './identity.js';

/**
 * What the customer app looks like: the categories it browses by, and the
 * banners across the top of it.
 *
 * Categories used to be a constant compiled into `@jibli/contracts`. That was
 * right while the list was a vocabulary — something restaurants are *tagged*
 * with, checked at the API boundary so that "دجاج" and "الدجاج" never became
 * two filters. It stops being right the moment the list is also merchandising:
 * an operator who wants a Ramadan category, or wants حلويات above برغر this
 * week, cannot ship a release to do it.
 *
 * So the vocabulary moves into the database. The contract keeps its list as
 * the seed and as the fallback for a client that cannot reach the API, but the
 * database is what the app reads.
 */

export const appCategories = pgTable(
  'app_categories',
  {
    id: primaryId(),
    /**
     * The stable identifier restaurants are tagged with. Never edited once
     * created: a restaurant carries this string in `cuisine_tags`, and
     * renaming it would silently orphan every restaurant in the category.
     * The Arabic name is what changes.
     */
    key: text('key').notNull(),
    nameAr: text('name_ar').notNull(),
    /**
     * Which storefront this category belongs to (migration 0017).
     *
     * A cuisine tag and a grocery aisle are both categories and never appear
     * together: «برجر» above a list of groceries is a filter that lies.
     */
    merchantType: text('merchant_type').$type<MerchantType>().notNull().default('RESTAURANT'),
    /** Shown when there is no image, and in dense lists where one would not fit. */
    emoji: text('emoji'),
    /** Uploaded through the same asset pipeline as a restaurant logo. */
    imageAssetId: fk('image_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    /**
     * Where it sits in the app. Sparse on purpose — new categories land at the
     * end with room to be dragged between existing ones without renumbering
     * every row.
     */
    sortOrder: integer('sort_order').notNull().default(0),
    /**
     * Hidden rather than deleted. A category with restaurants in it cannot be
     * removed without orphaning their tags, and an operator who wants it gone
     * from the app means hidden, not destroyed.
     */
    isActive: boolean('is_active').notNull().default(true),
    createdBy: fk('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('app_categories_key').on(table.key),
    index('app_categories_order_idx').on(table.sortOrder),
  ],
);

/** Where tapping a banner takes the customer. */
export type BannerLinkType = 'NONE' | 'CATEGORY' | 'RESTAURANT' | 'URL';

export const appBanners = pgTable(
  'app_banners',
  {
    id: primaryId(),
    titleAr: text('title_ar').notNull(),
    subtitleAr: text('subtitle_ar'),
    /**
     * Which storefront this banner runs in (migration 0017).
     *
     * The one paid placement in the app, sold per season and per partner. A
     * Ramadan offer from a restaurant has no business rotating above a grocery
     * basket — selling a placement means promising where it appears.
     */
    merchantType: text('merchant_type').$type<MerchantType>().notNull().default('RESTAURANT'),
    imageAssetId: fk('image_asset_id').references(() => assets.id, { onDelete: 'set null' }),
    linkType: text('link_type').$type<BannerLinkType>().notNull().default('NONE'),
    /** A category key, a restaurant id, or a URL, depending on `linkType`. */
    linkValue: text('link_value'),
    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    /**
     * A scheduled window. Both null means "always", which is the common case;
     * a Ramadan banner that stops being true on the 30th is why the columns
     * exist rather than relying on someone remembering to switch it off.
     */
    startsAt: utcTimestamp('starts_at'),
    endsAt: utcTimestamp('ends_at'),
    createdBy: fk('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('app_banners_order_idx').on(table.isActive, table.sortOrder)],
);

export type AppCategoryRow = typeof appCategories.$inferSelect;
export type AppBannerRow = typeof appBanners.$inferSelect;
