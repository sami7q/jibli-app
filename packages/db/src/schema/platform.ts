import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type {
  CouponFundingSource,
  CouponType,
  NotificationChannel,
  OutboxStatus,
} from '@jibli/contracts';
import { bytea, createdAt, fk, money, primaryId, updatedAt, utcTimestamp } from './_shared.js';
import { users } from './identity.js';
import { restaurants } from './restaurants.js';

/**
 * Platform plumbing: outbox, configuration, notifications, coupons, assets.
 */

/**
 * Transactional outbox (plan §31).
 *
 * The event row is written in the same transaction as the state change, so an
 * order is never "placed but unannounced". The worker publishes and marks.
 */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: primaryId(),
    eventType: text('event_type').notNull(),
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    aggregateVersion: integer('aggregate_version').notNull().default(0),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').$type<OutboxStatus>().notNull().default('PENDING'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    /** Backoff target; the poller ignores rows scheduled for the future. */
    nextAttemptAt: utcTimestamp('next_attempt_at').notNull().defaultNow(),
    publishedAt: utcTimestamp('published_at'),
    requestId: text('request_id'),
    createdAt: createdAt(),
  },
  (table) => [
    // The poller's hot path: pending work that is due.
    index('outbox_events_pending_idx').on(table.status, table.nextAttemptAt),
    index('outbox_events_aggregate_idx').on(table.aggregateType, table.aggregateId),
  ],
);

/**
 * Notification deliveries (plan §56).
 *
 * The unique index on (event, recipient, channel) is what stops a retried worker
 * from alerting the same person twice (plan §99).
 */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: primaryId(),
    outboxEventId: fk('outbox_event_id').references(() => outboxEvents.id, { onDelete: 'cascade' }),
    recipientUserId: fk('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    channel: text('channel').$type<NotificationChannel>().notNull(),
    titleAr: text('title_ar').notNull(),
    bodyAr: text('body_ar').notNull(),
    dataJson: jsonb('data_json').$type<Record<string, unknown>>(),
    status: text('status').notNull().default('PENDING'),
    sentAt: utcTimestamp('sent_at'),
    readAt: utcTimestamp('read_at'),
    failureReason: text('failure_reason'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('notification_deliveries_unique').on(
      table.outboxEventId,
      table.recipientUserId,
      table.channel,
    ),
    index('notification_deliveries_recipient_idx').on(table.recipientUserId, table.createdAt),
  ],
);

/**
 * Admin-managed runtime configuration (plan §118).
 *
 * The mobile app never hard-codes the service fee or the minimum version.
 */
export const platformConfig = pgTable(
  'platform_config',
  {
    id: primaryId(),
    key: text('key').notNull(),
    value: jsonb('value').$type<unknown>().notNull(),
    descriptionAr: text('description_ar'),
    /** Sensitive keys require a reason and stronger permission to change. */
    isSensitive: boolean('is_sensitive').notNull().default(false),
    updatedBy: fk('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('platform_config_key_key').on(table.key)],
);

/** Versioned history of configuration changes, so a bad value can be traced. */
export const platformConfigHistory = pgTable(
  'platform_config_history',
  {
    id: primaryId(),
    key: text('key').notNull(),
    previousValue: jsonb('previous_value').$type<unknown>(),
    newValue: jsonb('new_value').$type<unknown>().notNull(),
    reason: text('reason'),
    changedBy: fk('changed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [index('platform_config_history_key_idx').on(table.key, table.createdAt)],
);

/**
 * Feature flags (plan §117).
 *
 * A flag can gate a staged rollout but "cannot make a disabled city orderable" —
 * authorization and geography are evaluated independently of flags.
 */
export const featureFlags = pgTable(
  'feature_flags',
  {
    id: primaryId(),
    key: text('key').notNull(),
    isEnabled: boolean('is_enabled').notNull().default(false),
    descriptionAr: text('description_ar'),
    /** Optional narrowing: specific restaurants or cities. */
    scopeJson: jsonb('scope_json').$type<Record<string, unknown>>(),
    rolloutPercentage: integer('rollout_percentage').notNull().default(0),
    updatedBy: fk('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('feature_flags_key_key').on(table.key)],
);

/** Coupons (plan §60). Funding source decides commission impact. */
export const coupons = pgTable(
  'coupons',
  {
    id: primaryId(),
    code: text('code').notNull(),
    type: text('type').$type<CouponType>().notNull(),
    /** For PERCENTAGE this is basis points; for FIXED_AMOUNT it is IQD. */
    value: integer('value').notNull(),
    maxDiscountIqd: money('max_discount_iqd'),
    minimumOrderIqd: money('minimum_order_iqd').notNull().default(0),
    fundingSource: text('funding_source').$type<CouponFundingSource>().notNull(),
    /** For SHARED funding: the restaurant's share in basis points. */
    restaurantShareBps: integer('restaurant_share_bps'),
    /** Null means platform-wide. */
    restaurantId: fk('restaurant_id').references(() => restaurants.id, { onDelete: 'cascade' }),
    cityIds: jsonb('city_ids').$type<string[]>(),
    totalUsageLimit: integer('total_usage_limit'),
    perUserUsageLimit: integer('per_user_usage_limit').notNull().default(1),
    usageCount: integer('usage_count').notNull().default(0),
    startsAt: utcTimestamp('starts_at').notNull(),
    endsAt: utcTimestamp('ends_at'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: fk('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('coupons_code_key').on(table.code),
    index('coupons_active_idx').on(table.isActive, table.startsAt, table.endsAt),
  ],
);

export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    id: primaryId(),
    couponId: fk('coupon_id')
      .notNull()
      .references(() => coupons.id, { onDelete: 'cascade' }),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orderId: fk('order_id').notNull(),
    discountAppliedIqd: money('discount_applied_iqd').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('coupon_redemptions_order_key').on(table.orderId),
    index('coupon_redemptions_user_idx').on(table.couponId, table.userId),
  ],
);

/**
 * Object-storage assets (plan §83, §121).
 *
 * Private documents are never exposed by public URL; the visibility column is
 * what the signed-URL issuer checks.
 */
export const assets = pgTable(
  'assets',
  {
    id: primaryId(),
    /** Generated storage key — never the user's original filename. */
    storageKey: text('storage_key').notNull(),
    bucket: text('bucket').notNull(),
    visibility: text('visibility').notNull().default('PRIVATE'),
    contentType: text('content_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    width: integer('width'),
    height: integer('height'),
    /** Optimised derivatives: thumbnail, card, full. */
    variantsJson: jsonb('variants_json').$type<Record<string, string>>(),
    ownerUserId: fk('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    restaurantId: fk('restaurant_id').references(() => restaurants.id, { onDelete: 'cascade' }),
    scanStatus: text('scan_status').notNull().default('PENDING'),
    createdAt: createdAt(),
    deletedAt: utcTimestamp('deleted_at'),
  },
  (table) => [
    uniqueIndex('assets_storage_key_key').on(table.storageKey),
    index('assets_restaurant_idx').on(table.restaurantId),
  ],
);

/**
 * The bytes behind an asset (migration 0006).
 *
 * A separate table on purpose: `select *` on `assets` must never drag image
 * data across the wire. Only the route that serves an image reads from here.
 */
export const assetBytes = pgTable('asset_bytes', {
  assetId: fk('asset_id')
    .primaryKey()
    .references(() => assets.id, { onDelete: 'cascade' }),
  data: bytea('data').notNull(),
  createdAt: createdAt(),
});

/** Distributed locks for scheduled jobs (plan §94). DB-backed so it survives a Redis flush. */
export const jobLocks = pgTable(
  'job_locks',
  {
    id: primaryId(),
    lockKey: text('lock_key').notNull(),
    ownerToken: text('owner_token').notNull(),
    acquiredAt: utcTimestamp('acquired_at').notNull().defaultNow(),
    expiresAt: utcTimestamp('expires_at').notNull(),
  },
  (table) => [uniqueIndex('job_locks_key_key').on(table.lockKey)],
);

export type OutboxEventRow = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;
export type PlatformConfigRow = typeof platformConfig.$inferSelect;
export type FeatureFlagRow = typeof featureFlags.$inferSelect;
export type CouponRow = typeof coupons.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
