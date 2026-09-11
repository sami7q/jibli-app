import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  BusyMode,
  OnboardingStatus,
  OperationalStatus,
  ProviderType,
  RestaurantRole,
} from '@jibli/contracts';
import { createdAt, deletedAt, fk, money, primaryId, updatedAt, utcTimestamp } from './_shared.js';
import { cities, governorates } from './geography.js';
import { users } from './identity.js';

/**
 * Providers, restaurants, branches and staff (plan §15–§18).
 *
 * The provider layer exists so water factories, tankers, gas and grocery can be
 * added later without rebuilding identity, geography or ordering (plan §16).
 */

export const providers = pgTable(
  'providers',
  {
    id: primaryId(),
    providerType: text('provider_type').$type<ProviderType>().notNull().default('RESTAURANT'),
    status: text('status').$type<OperationalStatus>().notNull().default('PENDING'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('providers_type_idx').on(table.providerType, table.status)],
);

export const restaurants = pgTable(
  'restaurants',
  {
    id: primaryId(),
    providerId: fk('provider_id')
      .notNull()
      .references(() => providers.id, { onDelete: 'restrict' }),
    displayName: text('display_name').notNull(),
    legalName: text('legal_name'),
    /** Short public code shown in the portal header, e.g. "#2847" in the designs. */
    partnerCode: text('partner_code').notNull(),
    descriptionAr: text('description_ar'),

    onboardingStatus: text('onboarding_status')
      .$type<OnboardingStatus>()
      .notNull()
      .default('DRAFT'),
    operationalStatus: text('operational_status')
      .$type<OperationalStatus>()
      .notNull()
      .default('PENDING'),

    logoAssetId: fk('logo_asset_id'),
    coverAssetId: fk('cover_asset_id'),
    cuisineTags: jsonb('cuisine_tags').$type<string[]>().notNull().default([]),

    /** Denormalised rating; recomputed from reviews, never edited by hand. */
    ratingAverage: doublePrecision('rating_average'),
    ratingCount: integer('rating_count').notNull().default(0),

    minimumOrderIqd: money('minimum_order_iqd').notNull().default(0),
    /** Bumped whenever the catalog changes, so carts can detect staleness (plan §116). */
    menuVersion: integer('menu_version').notNull().default(1),

    approvedAt: utcTimestamp('approved_at'),
    approvedBy: fk('approved_by').references(() => users.id, { onDelete: 'set null' }),
    suspendedAt: utcTimestamp('suspended_at'),
    suspendedReason: text('suspended_reason'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    uniqueIndex('restaurants_partner_code_key').on(table.partnerCode),
    index('restaurants_status_idx').on(table.onboardingStatus, table.operationalStatus),
    index('restaurants_provider_idx').on(table.providerId),
  ],
);

export const restaurantBranches = pgTable(
  'restaurant_branches',
  {
    id: primaryId(),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    governorateId: fk('governorate_id')
      .notNull()
      .references(() => governorates.id, { onDelete: 'restrict' }),
    cityId: fk('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    addressText: text('address_text').notNull(),
    districtText: text('district_text'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    phone: text('phone'),

    isActive: boolean('is_active').notNull().default(false),
    /** Separate from isActive: a branch can be open but not taking orders. */
    acceptsOrders: boolean('accepts_orders').notNull().default(false),

    /** Plan §33: busy mode adds preparation minutes and can auto-expire. */
    busyMode: text('busy_mode').$type<BusyMode>().notNull().default('NORMAL'),
    busyModeExpiresAt: utcTimestamp('busy_mode_expires_at'),

    basePreparationMinutes: integer('base_preparation_minutes').notNull().default(30),
    deliveryFeeIqd: money('delivery_fee_iqd').notNull().default(0),
    /** Optional radius service zone; polygons are a later PostGIS decision (plan §106). */
    serviceRadiusMeters: integer('service_radius_meters'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (table) => [
    // Plan §98: the marketplace discovery index.
    index('restaurant_branches_city_active_idx').on(table.cityId, table.isActive),
    index('restaurant_branches_restaurant_idx').on(table.restaurantId),
  ],
);

/**
 * Weekly working hours (plan §33, §105).
 *
 * Overnight ranges such as 18:00–02:00 are expressed with an end time smaller
 * than the start time; the evaluation service handles the wrap.
 */
export const branchWorkingHours = pgTable(
  'branch_working_hours',
  {
    id: primaryId(),
    branchId: fk('branch_id')
      .notNull()
      .references(() => restaurantBranches.id, { onDelete: 'cascade' }),
    /** 0 = Sunday … 6 = Saturday, in Asia/Baghdad. */
    dayOfWeek: integer('day_of_week').notNull(),
    /** Minutes from local midnight, 0..1439. */
    opensAtMinute: integer('opens_at_minute').notNull(),
    closesAtMinute: integer('closes_at_minute').notNull(),
    isClosed: boolean('is_closed').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('branch_working_hours_branch_idx').on(table.branchId, table.dayOfWeek)],
);

/** Holiday or special-day overrides that beat the weekly schedule (plan §105). */
export const branchHourExceptions = pgTable(
  'branch_hour_exceptions',
  {
    id: primaryId(),
    branchId: fk('branch_id')
      .notNull()
      .references(() => restaurantBranches.id, { onDelete: 'cascade' }),
    /** Local calendar date in Asia/Baghdad, stored as YYYY-MM-DD. */
    localDate: text('local_date').notNull(),
    isClosed: boolean('is_closed').notNull().default(true),
    opensAtMinute: integer('opens_at_minute'),
    closesAtMinute: integer('closes_at_minute'),
    noteAr: text('note_ar'),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('branch_hour_exceptions_unique').on(table.branchId, table.localDate)],
);

/**
 * Restaurant staff membership (plan §63).
 *
 * Authorization resolves from this table against the authenticated session. A
 * submitted restaurant_id is never proof of access.
 */
export const restaurantMembers = pgTable(
  'restaurant_members',
  {
    id: primaryId(),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<RestaurantRole>().notNull(),
    /** Null means all branches of the restaurant. */
    branchId: fk('branch_id').references(() => restaurantBranches.id, { onDelete: 'cascade' }),
    isActive: boolean('is_active').notNull().default(true),
    invitedBy: fk('invited_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deactivatedAt: utcTimestamp('deactivated_at'),
  },
  (table) => [
    // Plan §98: membership lookup on every restaurant-portal request.
    index('restaurant_members_user_idx').on(table.userId, table.restaurantId),
    uniqueIndex('restaurant_members_unique').on(table.restaurantId, table.userId, table.role),
  ],
);

/** Self-onboarding applications (plan §15.2, §69). */
export const restaurantApplications = pgTable(
  'restaurant_applications',
  {
    id: primaryId(),
    /** Populated once approved and a restaurant record is created. */
    restaurantId: fk('restaurant_id').references(() => restaurants.id, { onDelete: 'set null' }),
    applicantUserId: fk('applicant_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    displayName: text('display_name').notNull(),
    contactPhoneE164: text('contact_phone_e164').notNull(),
    governorateId: fk('governorate_id')
      .notNull()
      .references(() => governorates.id, { onDelete: 'restrict' }),
    cityId: fk('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    addressText: text('address_text').notNull(),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    cuisineTags: jsonb('cuisine_tags').$type<string[]>().notNull().default([]),
    documentsJson: jsonb('documents_json').$type<Record<string, unknown>>(),

    status: text('status').$type<OnboardingStatus>().notNull().default('UNDER_REVIEW'),
    reviewedBy: fk('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: utcTimestamp('reviewed_at'),
    reviewNote: text('review_note'),
    rejectionReason: text('rejection_reason'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('restaurant_applications_status_idx').on(table.status, table.createdAt),
    index('restaurant_applications_city_idx').on(table.cityId),
  ],
);

/**
 * Relocation requests (plan §17, §123).
 *
 * A restaurant cannot move between markets by editing a dropdown; the change is
 * an approval workflow that leaves historical snapshots untouched.
 */
export const branchLocationChangeRequests = pgTable(
  'branch_location_change_requests',
  {
    id: primaryId(),
    branchId: fk('branch_id')
      .notNull()
      .references(() => restaurantBranches.id, { onDelete: 'cascade' }),
    requestedBy: fk('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    currentGovernorateId: fk('current_governorate_id').notNull(),
    currentCityId: fk('current_city_id').notNull(),
    requestedGovernorateId: fk('requested_governorate_id')
      .notNull()
      .references(() => governorates.id, { onDelete: 'restrict' }),
    requestedCityId: fk('requested_city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    requestedAddressText: text('requested_address_text').notNull(),
    requestedLatitude: doublePrecision('requested_latitude'),
    requestedLongitude: doublePrecision('requested_longitude'),
    status: text('status').notNull().default('PENDING'),
    decidedBy: fk('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: utcTimestamp('decided_at'),
    effectiveAt: utcTimestamp('effective_at'),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
  },
  (table) => [index('branch_location_changes_branch_idx').on(table.branchId, table.status)],
);

export const restaurantsRelations = relations(restaurants, ({ many, one }) => ({
  provider: one(providers, { fields: [restaurants.providerId], references: [providers.id] }),
  branches: many(restaurantBranches),
  members: many(restaurantMembers),
}));

export const restaurantBranchesRelations = relations(restaurantBranches, ({ one, many }) => ({
  restaurant: one(restaurants, {
    fields: [restaurantBranches.restaurantId],
    references: [restaurants.id],
  }),
  city: one(cities, { fields: [restaurantBranches.cityId], references: [cities.id] }),
  governorate: one(governorates, {
    fields: [restaurantBranches.governorateId],
    references: [governorates.id],
  }),
  workingHours: many(branchWorkingHours),
}));

export type RestaurantRow = typeof restaurants.$inferSelect;
export type RestaurantBranchRow = typeof restaurantBranches.$inferSelect;
export type RestaurantMemberRow = typeof restaurantMembers.$inferSelect;
export type BranchWorkingHourRow = typeof branchWorkingHours.$inferSelect;
export type RestaurantApplicationRow = typeof restaurantApplications.$inferSelect;
