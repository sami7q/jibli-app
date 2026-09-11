import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

/**
 * Database client.
 *
 * PostgreSQL is authoritative for orders, finance, users, restaurants, geography
 * and assignments (plan §92). Redis caches; it never owns a uniqueness rule.
 */

export type Database = PostgresJsDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Accepts either a pooled connection or an open transaction. */
export type DbExecutor = Database | Transaction;

export interface DatabaseOptions {
  readonly connectionString: string;
  readonly maxConnections?: number;
  readonly ssl?: boolean;
  readonly applicationName?: string;
  /** Migrations run single-connection and must not share the app pool. */
  readonly maxLifetimeSeconds?: number;
}

let sharedClient: postgres.Sql | undefined;
let sharedDb: Database | undefined;

export function createDatabase(options: DatabaseOptions): { db: Database; sql: postgres.Sql } {
  const sql = postgres(options.connectionString, {
    max: options.maxConnections ?? 10,
    ssl: options.ssl ? 'require' : false,
    connection: { application_name: options.applicationName ?? 'jibli' },
    max_lifetime: options.maxLifetimeSeconds ?? 60 * 30,
    // Money columns are bigint; postgres.js would hand back strings by default.
    // Drizzle's bigint mode:'number' relies on this transform being consistent.
    types: {
      bigint: {
        to: 20,
        from: [20],
        serialize: (value: number) => String(value),
        parse: (value: string) => Number(value),
      },
    },
    onnotice: () => {
      /* suppress NOTICE chatter in application logs */
    },
  });

  const db = drizzle(sql, { schema, logger: false });
  return { db, sql };
}

/** Process-wide singleton used by the API and worker. */
export function getDatabase(options: DatabaseOptions): Database {
  if (!sharedDb) {
    const created = createDatabase(options);
    sharedClient = created.sql;
    sharedDb = created.db;
  }
  return sharedDb;
}

export async function closeDatabase(): Promise<void> {
  if (sharedClient) {
    await sharedClient.end({ timeout: 5 });
    sharedClient = undefined;
    sharedDb = undefined;
  }
}

/** Readiness probe: cheap, and never an analytics query (plan §90). */
export async function pingDatabase(db: Database): Promise<boolean> {
  try {
    await db.execute(`select 1`);
    return true;
  } catch {
    return false;
  }
}

export { schema };
