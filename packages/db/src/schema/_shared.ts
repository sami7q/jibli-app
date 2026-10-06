import { sql } from 'drizzle-orm';
import { bigint, customType, numeric, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Column builders shared by every table.
 *
 * Centralising them means the platform's data-type decisions (plan §100–§102)
 * are made once: money is an integer, quantities are fixed-precision decimals,
 * and every timestamp is stored in UTC.
 */

/** Primary key. Application code supplies a UUIDv7 (plan §25); the default is a safety net. */
export const primaryId = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);

export const fk = (name: string) => uuid(name);

/**
 * Money column. IQD is a zero-decimal currency in Release 1, so amounts are
 * whole dinars stored as integers — never numeric, never float (plan §100).
 * bigint because settlement and report aggregates exceed int4.
 */
export const money = (name: string) => bigint(name, { mode: 'number' });

/**
 * Inventory quantity. Grams and litres need decimals, and binary floating point
 * is not acceptable for stock that feeds cost of goods (plan §101).
 */
export const quantity = (name: string) => numeric(name, { precision: 14, scale: 3 });

/** UTC instant. Business dates are derived in Asia/Baghdad at read time (plan §4.8). */
export const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const createdAt = () => utcTimestamp('created_at').notNull().defaultNow();
export const updatedAt = () => utcTimestamp('updated_at').notNull().defaultNow();

/** Soft deletion for commercial/identity records with historical relationships (plan §4.7). */
export const deletedAt = () => utcTimestamp('deleted_at');

/** Optimistic concurrency token for aggregates that accept concurrent commands. */
export const version = () => bigint('version', { mode: 'number' }).notNull().default(0);

/**
 * Raw bytes.
 *
 * drizzle-orm has no `bytea` builder, and the driver hands the column back as a
 * Node Buffer either way, so the type is declared here once rather than cast at
 * every call site.
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});
