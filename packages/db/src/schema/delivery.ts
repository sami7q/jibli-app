import { relations } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import type {
  DeliveryAssignmentStatus,
  DriverAccountStatus,
  DriverAvailability,
  DriverCashEventType,
  VehicleType,
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
import { users } from './identity.js';
import { orders } from './orders.js';
import { restaurantBranches, restaurants } from './restaurants.js';

/**
 * Drivers and delivery (plan §45–§54).
 *
 * Release 1 drivers belong to restaurants. There is no open driver marketplace
 * and no continuous GPS upload (plan §51).
 */

export const drivers = pgTable(
  'drivers',
  {
    id: primaryId(),
    userId: fk('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Account state — separate from availability (plan §46). */
    status: text('status').$type<DriverAccountStatus>().notNull().default('PENDING_ACTIVATION'),
    availability: text('availability').$type<DriverAvailability>().notNull().default('OFFLINE'),
    defaultVehicleType: text('default_vehicle_type').$type<VehicleType>().notNull().default('MOTORCYCLE'),
    plateNumber: text('plate_number'),
    photoAssetId: fk('photo_asset_id'),
    /**
     * Lightweight presence heartbeat while Driver Mode is open. This is presence,
     * not location tracking (plan §51).
     */
    lastHeartbeatAt: utcTimestamp('last_heartbeat_at'),
    activatedAt: utcTimestamp('activated_at'),
    suspendedAt: utcTimestamp('suspended_at'),
    suspendedReason: text('suspended_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('drivers_user_key').on(table.userId),
    index('drivers_status_idx').on(table.status, table.availability),
  ],
);

/** Which restaurant a driver works for (plan §46). */
export const restaurantDrivers = pgTable(
  'restaurant_drivers',
  {
    id: primaryId(),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'cascade' }),
    branchId: fk('branch_id').references(() => restaurantBranches.id, { onDelete: 'set null' }),
    driverId: fk('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    canCollectCash: boolean('can_collect_cash').notNull().default(true),
    isActive: boolean('is_active').notNull().default(true),
    internalNote: text('internal_note'),
    createdBy: fk('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    deactivatedAt: utcTimestamp('deactivated_at'),
  },
  (table) => [
    uniqueIndex('restaurant_drivers_unique').on(table.restaurantId, table.driverId),
    index('restaurant_drivers_restaurant_idx').on(table.restaurantId, table.isActive),
  ],
);

/**
 * Delivery assignments (plan §48, §104).
 *
 * Reassignment does not erase history: the old row is preserved so disputes and
 * driver performance reports can be investigated.
 */
export const deliveryAssignments = pgTable(
  'delivery_assignments',
  {
    id: primaryId(),
    orderId: fk('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'restrict' }),
    branchId: fk('branch_id')
      .notNull()
      .references(() => restaurantBranches.id, { onDelete: 'restrict' }),
    driverId: fk('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    status: text('status').$type<DeliveryAssignmentStatus>().notNull().default('ASSIGNED'),
    assignedBy: fk('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    assignedAt: utcTimestamp('assigned_at').notNull().defaultNow(),
    acceptedAt: utcTimestamp('accepted_at'),
    pickedUpAt: utcTimestamp('picked_up_at'),
    arrivedCustomerAt: utcTimestamp('arrived_customer_at'),
    deliveredAt: utcTimestamp('delivered_at'),
    cancelledAt: utcTimestamp('cancelled_at'),
    rejectionReason: text('rejection_reason'),
    cancellationReason: text('cancellation_reason'),
    /** Set when a later assignment supersedes this one. */
    replacedByAssignmentId: fk('replaced_by_assignment_id'),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // Plan §98: the driver's task list.
    index('delivery_assignments_driver_idx').on(table.driverId, table.status, table.createdAt),
    index('delivery_assignments_order_idx').on(table.orderId),
    index('delivery_assignments_restaurant_idx').on(table.restaurantId, table.status),
  ],
);

/**
 * Driver cash custody (plan §54).
 *
 * COD collected by a driver is restaurant cash custody, not a Jibli commission
 * payment. These two balances never mix.
 */
export const driverCashEvents = pgTable(
  'driver_cash_events',
  {
    id: primaryId(),
    driverId: fk('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'restrict' }),
    type: text('type').$type<DriverCashEventType>().notNull(),
    /** Positive increases custody, negative decreases it. */
    amountIqd: money('amount_iqd').notNull(),
    orderId: fk('order_id').references(() => orders.id, { onDelete: 'set null' }),
    handoverId: fk('handover_id'),
    note: text('note'),
    actorUserId: fk('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Prevents a retried delivery confirmation from double-crediting custody. */
    idempotencyKey: text('idempotency_key'),
    createdAt: createdAt(),
  },
  (table) => [
    index('driver_cash_events_driver_idx').on(table.driverId, table.createdAt),
    index('driver_cash_events_restaurant_idx').on(table.restaurantId, table.createdAt),
    uniqueIndex('driver_cash_events_idempotency_key').on(table.idempotencyKey),
  ],
);

/** A confirmed handover is immutable; corrections use CASH_ADJUSTMENT events. */
export const driverCashHandovers = pgTable(
  'driver_cash_handovers',
  {
    id: primaryId(),
    driverId: fk('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'restrict' }),
    restaurantId: fk('restaurant_id')
      .notNull()
      .references(() => restaurants.id, { onDelete: 'restrict' }),
    amountIqd: money('amount_iqd').notNull(),
    receivedByUserId: fk('received_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    reference: text('reference'),
    note: text('note'),
    confirmedAt: utcTimestamp('confirmed_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [index('driver_cash_handovers_driver_idx').on(table.driverId, table.createdAt)],
);

/** Rate-limit state for delivery PIN entry (plan §52). */
export const deliveryPinAttempts = pgTable(
  'delivery_pin_attempts',
  {
    id: primaryId(),
    orderId: fk('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    driverId: fk('driver_id')
      .notNull()
      .references(() => drivers.id, { onDelete: 'cascade' }),
    succeeded: boolean('succeeded').notNull(),
    /** The submitted PIN is never stored, only the outcome. */
    attemptNumber: integer('attempt_number').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('delivery_pin_attempts_order_idx').on(table.orderId, table.createdAt)],
);

export const driversRelations = relations(drivers, ({ one, many }) => ({
  user: one(users, { fields: [drivers.userId], references: [users.id] }),
  memberships: many(restaurantDrivers),
  assignments: many(deliveryAssignments),
}));

export const deliveryAssignmentsRelations = relations(deliveryAssignments, ({ one }) => ({
  order: one(orders, { fields: [deliveryAssignments.orderId], references: [orders.id] }),
  driver: one(drivers, { fields: [deliveryAssignments.driverId], references: [drivers.id] }),
}));

export type DriverRow = typeof drivers.$inferSelect;
export type RestaurantDriverRow = typeof restaurantDrivers.$inferSelect;
export type DeliveryAssignmentRow = typeof deliveryAssignments.$inferSelect;
export type DriverCashEventRow = typeof driverCashEvents.$inferSelect;
