import { relations } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, fk, primaryId, updatedAt, utcTimestamp } from './_shared.js';

/**
 * Iraq geography master data (plan §8, Appendix B).
 *
 * Every capability defaults to FALSE. "The safest launch posture is that all
 * master records exist but all business capabilities default to false until
 * Operations explicitly activates launch areas" (plan §9).
 */

export const governorates = pgTable(
  'governorates',
  {
    id: primaryId(),
    /** Canonical stable code, e.g. IQ-BG. The seed importer's natural key. */
    code: text('code').notNull(),
    nameAr: text('name_ar').notNull(),
    /** Engineering/reporting metadata only — Release 1 interfaces show Arabic. */
    nameEnInternal: text('name_en_internal'),

    /** Master switch. A disabled row has no capabilities regardless of the flags below. */
    isEnabled: boolean('is_enabled').notNull().default(false),
    customerSignupEnabled: boolean('customer_signup_enabled').notNull().default(false),
    restaurantOnboardingEnabled: boolean('restaurant_onboarding_enabled').notNull().default(false),
    orderingEnabled: boolean('ordering_enabled').notNull().default(false),

    sortOrder: integer('sort_order').notNull().default(0),
    /** Which master-data release this row came from (plan §9). */
    sourceVersion: text('source_version').notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('governorates_code_key').on(table.code),
    index('governorates_ordering_idx').on(table.orderingEnabled, table.sortOrder),
  ],
);

export const cities = pgTable(
  'cities',
  {
    id: primaryId(),
    governorateId: fk('governorate_id')
      .notNull()
      .references(() => governorates.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    nameAr: text('name_ar').notNull(),
    nameEnInternal: text('name_en_internal'),

    isEnabled: boolean('is_enabled').notNull().default(false),
    customerSignupEnabled: boolean('customer_signup_enabled').notNull().default(false),
    restaurantOnboardingEnabled: boolean('restaurant_onboarding_enabled').notNull().default(false),
    orderingEnabled: boolean('ordering_enabled').notNull().default(false),

    sortOrder: integer('sort_order').notNull().default(0),
    sourceVersion: text('source_version').notNull(),
    /**
     * Administrative units change. A unit that no longer exists is marked, never
     * deleted, because historical orders reference it (plan §8.2, §9).
     */
    deprecatedAt: utcTimestamp('deprecated_at'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('cities_code_key').on(table.code),
    // Plan §98: the marketplace's hottest geography lookup.
    index('cities_governorate_ordering_idx').on(table.governorateId, table.orderingEnabled),
    index('cities_governorate_sort_idx').on(table.governorateId, table.sortOrder),
  ],
);

export const governoratesRelations = relations(governorates, ({ many }) => ({
  cities: many(cities),
}));

export const citiesRelations = relations(cities, ({ one }) => ({
  governorate: one(governorates, {
    fields: [cities.governorateId],
    references: [governorates.id],
  }),
}));

export type GovernorateRow = typeof governorates.$inferSelect;
export type CityRow = typeof cities.$inferSelect;
export type NewGovernorate = typeof governorates.$inferInsert;
export type NewCity = typeof cities.$inferInsert;
