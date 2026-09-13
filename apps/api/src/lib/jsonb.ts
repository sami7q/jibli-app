import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

/**
 * Does this jsonb array contain the value?
 *
 * `restaurants.cuisine_tags` is `jsonb`, not `text[]`. The two look identical
 * in TypeScript — both are `string[]` — and behave nothing alike in Postgres:
 *
 *   cuisine_tags = ANY(...)        → op ANY/ALL (array) requires array on right
 *   cuisine_tags @> ARRAY['x']     → operator does not exist: jsonb @> text[]
 *   cuisine_tags @> jsonb_build_array('x')   ← this one
 *
 * Drizzle's `arrayContains` builds the second of those, so it typechecks
 * perfectly and fails at runtime. That is worth one named helper rather than
 * three call sites each rediscovering it.
 *
 * The `::text` is not decoration. A value arrives as a bind parameter with no
 * declared type, and `jsonb_build_array($1)` is polymorphic, so Postgres
 * answers "could not determine data type of parameter $1" and the request
 * 500s. The column form below needs no cast because a column already has one.
 */
export function jsonbArrayContains(column: PgColumn, value: string): SQL {
  return sql`${column} @> jsonb_build_array(${value}::text)`;
}

/**
 * The same test where the value is another table's column rather than a
 * literal — a correlated count of restaurants per category, for instance.
 */
export function jsonbArrayContainsColumn(column: PgColumn, other: PgColumn): SQL {
  return sql`${column} @> jsonb_build_array(${other})`;
}
