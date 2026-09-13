import { index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { createdAt, fk, primaryId, updatedAt, utcTimestamp } from './_shared.js';
import { users } from './identity.js';
import { restaurants } from './restaurants.js';

/**
 * Support: a restaurant talking to Jibli, and Jibli noticing.
 *
 * Until now a restaurant with a problem had one channel — phoning whoever they
 * happened to know — which means nothing is recorded, nobody else can pick it
 * up, and the same question gets a different answer twice. This is that
 * conversation, kept.
 *
 * A thread belongs to a restaurant, not to a person: staff change, and the
 * history of "what did we tell this restaurant about their settlement" must
 * survive the manager who asked. `openedBy` records who typed it.
 */

/** What the thread is about, so it can be routed and counted. */
export type SupportTopic =
  | 'ORDERS'
  | 'MENU'
  | 'FINANCE'
  | 'ACCOUNT'
  | 'TECHNICAL'
  | 'OTHER';

/**
 * OPEN — waiting on Jibli.
 * ANSWERED — Jibli replied; waiting on the restaurant.
 * RESOLVED — closed by either side.
 *
 * Two "waiting" states rather than one, because the queue an operator works is
 * "who is waiting for me", and a single OPEN flag cannot express it.
 */
export type SupportStatus = 'OPEN' | 'ANSWERED' | 'RESOLVED';

export type SupportPriority = 'NORMAL' | 'URGENT';

export const supportThreads = pgTable(
  'support_threads',
  {
    id: primaryId(),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    /** The person at the restaurant who opened it. */
    openedBy: fk('opened_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    subject: text('subject').notNull(),
    topic: text('topic').$type<SupportTopic>().notNull().default('OTHER'),
    status: text('status').$type<SupportStatus>().notNull().default('OPEN'),
    priority: text('priority').$type<SupportPriority>().notNull().default('NORMAL'),
    /**
     * Denormalised from the messages, and deliberately: the queue sorts by it
     * on every load, and deriving it would mean a correlated subquery per row
     * over the table that grows fastest here.
     */
    lastMessageAt: utcTimestamp('last_message_at').notNull(),
    lastMessageFrom: text('last_message_from').$type<'RESTAURANT' | 'JIBLI'>().notNull(),
    resolvedAt: utcTimestamp('resolved_at'),
    resolvedBy: fk('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // The operator's queue: open threads, oldest waiting first.
    index('support_threads_status_idx').on(table.status, table.lastMessageAt),
    index('support_threads_restaurant_idx').on(table.restaurantId, table.lastMessageAt),
  ],
);

export const supportMessages = pgTable(
  'support_messages',
  {
    id: primaryId(),
    threadId: fk('thread_id')
      .notNull()
      .references(() => supportThreads.id, { onDelete: 'cascade' }),
    /**
     * Which side wrote it. Stored rather than inferred from the author's roles:
     * a Jibli operator who later also owns a restaurant must not retroactively
     * turn their old replies into restaurant messages.
     */
    authorSide: text('author_side').$type<'RESTAURANT' | 'JIBLI'>().notNull(),
    authorUserId: fk('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Kept so a deleted account's messages still name who wrote them. */
    authorNameSnapshot: text('author_name_snapshot').notNull(),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('support_messages_thread_idx').on(table.threadId, table.createdAt)],
);

/**
 * Something happened that Jibli should look at.
 *
 * Not `notification_deliveries`, which is the outbound channel to a customer's
 * phone. This is the bell in the Admin portal: in-app, addressed to whoever is
 * on duty rather than to one person, and never sent anywhere.
 *
 * Read state is a separate table on purpose. A notification is one fact about
 * the platform, and two operators must be able to have seen it independently —
 * a `read_at` column would make the first one to look mark it read for
 * everybody.
 */
export type AdminNotificationKind =
  | 'APPLICATION_RECEIVED'
  | 'ACTIVATION_REQUESTED'
  | 'SUPPORT_MESSAGE'
  | 'SETTLEMENT_OVERDUE'
  | 'ORDER_CANCELLED'
  | 'REVIEW_POSTED';

export type AdminNotificationSeverity = 'INFO' | 'ATTENTION' | 'URGENT';

export const adminNotifications = pgTable(
  'admin_notifications',
  {
    id: primaryId(),
    kind: text('kind').$type<AdminNotificationKind>().notNull(),
    severity: text('severity').$type<AdminNotificationSeverity>().notNull().default('INFO'),
    titleAr: text('title_ar').notNull(),
    bodyAr: text('body_ar'),
    /** Where the bell takes you. A notification you cannot act on is noise. */
    linkPath: text('link_path'),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    restaurantId: fk('restaurant_id').references(() => restaurants.id, { onDelete: 'cascade' }),
    /**
     * Collapses repeats. A restaurant that sends four messages before anyone
     * looks should produce one unread bell entry, not four — the operator
     * opens the thread and sees all four.
     */
    dedupeKey: text('dedupe_key'),
    createdAt: createdAt(),
  },
  (table) => [
    index('admin_notifications_created_idx').on(table.createdAt),
    uniqueIndex('admin_notifications_dedupe_key').on(table.dedupeKey),
  ],
);

export const adminNotificationReads = pgTable(
  'admin_notification_reads',
  {
    id: primaryId(),
    notificationId: fk('notification_id')
      .notNull()
      .references(() => adminNotifications.id, { onDelete: 'cascade' }),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    readAt: createdAt(),
  },
  (table) => [
    uniqueIndex('admin_notification_reads_unique').on(table.notificationId, table.userId),
    index('admin_notification_reads_user_idx').on(table.userId),
  ],
);

export type SupportThreadRow = typeof supportThreads.$inferSelect;
export type SupportMessageRow = typeof supportMessages.$inferSelect;
export type AdminNotificationRow = typeof adminNotifications.$inferSelect;
