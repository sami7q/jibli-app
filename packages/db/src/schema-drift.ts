import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import postgres from 'postgres';
import * as schema from './schema/index.js';
import { shouldUseSsl } from './ssl.js';

/**
 * Does the TypeScript schema describe the database that actually exists?
 *
 * Migrations here are hand-written SQL and the Drizzle schema is hand-written
 * TypeScript, which means the two can disagree and nothing notices until a
 * query fails in production. That is not hypothetical: `admin_notification_reads`
 * shipped with a `read_at` column in SQL and `createdAt()` in the schema, which
 * generates `created_at` — every insert 500'd, and the only symptom was a bell
 * that would not clear.
 *
 * This reads `information_schema` and compares it against what Drizzle thinks
 * each table has. It reports three kinds of drift:
 *
 *   missing in database — the schema names a column the database lacks. This
 *                         is the one that breaks queries.
 *   missing in schema   — the database has a column no code can read. Usually
 *                         harmless, occasionally a forgotten migration.
 *   type mismatch       — same name, different type.
 *
 * Run it against a database that has had every migration applied:
 *
 *   DATABASE_URL=… pnpm --filter @jibli/db verify
 */

interface Drift {
  readonly table: string;
  readonly kind: 'MISSING_IN_DB' | 'MISSING_IN_SCHEMA' | 'TYPE';
  readonly detail: string;
}

/** Drizzle's column type names against what Postgres reports. */
const TYPE_ALIASES: Record<string, readonly string[]> = {
  PgUUID: ['uuid'],
  PgText: ['text', 'character varying'],
  PgVarchar: ['character varying', 'text'],
  PgInteger: ['integer'],
  PgBigInt53: ['bigint'],
  PgBigInt64: ['bigint'],
  PgDoublePrecision: ['double precision'],
  PgNumeric: ['numeric'],
  PgBoolean: ['boolean'],
  PgTimestamp: ['timestamp with time zone', 'timestamp without time zone'],
  PgJsonb: ['jsonb'],
  PgJson: ['json'],
  PgCustomColumn: [],
  PgArray: [],
};

export async function findSchemaDrift(connectionString: string): Promise<Drift[]> {
  const sql = postgres(connectionString, {
    max: 1,
    ssl: shouldUseSsl(connectionString, process.env.DATABASE_SSL) ? 'require' : false,
    onnotice: () => {},
  });

  try {
    const live = await sql<
      { table_name: string; column_name: string; data_type: string }[]
    >`
      SELECT table_name, column_name, data_type
        FROM information_schema.columns
       WHERE table_schema = 'public'
    `;

    const byTable = new Map<string, Map<string, string>>();
    for (const row of live) {
      const columns = byTable.get(row.table_name) ?? new Map<string, string>();
      columns.set(row.column_name, row.data_type);
      byTable.set(row.table_name, columns);
    }

    const drift: Drift[] = [];

    for (const exported of Object.values(schema)) {
      // The module exports helpers and types as well as tables.
      if (!isTable(exported)) continue;

      const config = getTableConfig(exported);
      const liveColumns = byTable.get(config.name);

      if (!liveColumns) {
        drift.push({
          table: config.name,
          kind: 'MISSING_IN_DB',
          detail: 'the whole table is absent — a migration was never applied',
        });
        continue;
      }

      const declared = new Set<string>();

      for (const column of config.columns) {
        declared.add(column.name);
        const liveType = liveColumns.get(column.name);

        if (liveType === undefined) {
          drift.push({
            table: config.name,
            kind: 'MISSING_IN_DB',
            detail: `${column.name} (${column.columnType})`,
          });
          continue;
        }

        const accepted = TYPE_ALIASES[column.columnType];
        // An unknown or custom Drizzle type is not evidence of a mismatch;
        // reporting one would train the reader to ignore this output.
        if (accepted && accepted.length > 0 && !accepted.includes(liveType)) {
          drift.push({
            table: config.name,
            kind: 'TYPE',
            detail: `${column.name}: schema says ${column.columnType}, database says ${liveType}`,
          });
        }
      }

      for (const [name] of liveColumns) {
        if (!declared.has(name)) {
          drift.push({ table: config.name, kind: 'MISSING_IN_SCHEMA', detail: name });
        }
      }
    }

    return drift.sort((a, b) => a.table.localeCompare(b.table) || a.detail.localeCompare(b.detail));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function isTable(value: unknown): value is PgTable {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.for('drizzle:IsDrizzleTable') in (value as Record<symbol, unknown>)
  );
}

// Invoked directly via `pnpm --filter @jibli/db verify`.
if (process.argv[1] && process.argv[1].endsWith('schema-drift.ts')) {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_MIGRATION_URL or DATABASE_URL must be set');
    process.exit(1);
  }

  findSchemaDrift(url)
    .then((drift) => {
      if (drift.length === 0) {
        console.log('Schema and database agree.');
        process.exit(0);
      }

      /*
       * Only a column the schema expects and the database lacks can break a
       * query, so only that fails the check. The rest is printed because it is
       * worth knowing and not worth blocking a deploy over.
       */
      const breaking = drift.filter((d) => d.kind === 'MISSING_IN_DB');

      for (const entry of drift) {
        console.log(`  [${entry.kind}] ${entry.table}.${entry.detail}`);
      }

      console.log(
        `\n${drift.length} difference(s), ${breaking.length} of which would break a query.`,
      );
      process.exit(breaking.length > 0 ? 1 : 0);
    })
    .catch((error: unknown) => {
      console.error('Could not check:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
