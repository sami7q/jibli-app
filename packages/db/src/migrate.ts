import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { loadDotEnv } from '@jibli/config';
import { shouldUseSsl } from './ssl.js';

/**
 * Migration runner.
 *
 * Plain SQL files applied in filename order, each inside its own transaction,
 * recorded with a checksum. Migrations run with DATABASE_MIGRATION_URL — a more
 * privileged credential than the application runtime user (plan §7).
 */

/**
 * Where the `.sql` files live.
 *
 * Relative to this module during development, because that is where they sit
 * in the repository. In the container the API is a single bundled `.mjs` and
 * this path means nothing, so the image sets MIGRATIONS_DIR to the directory
 * it copied them into. Stated rather than guessed: a runner that searches for
 * its own migrations can find none and report success.
 */
const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * One advisory lock, so two processes cannot migrate at once.
 *
 * Render restarts the API and the worker from the same image, and a rolling
 * deploy briefly runs two API instances. Without this they race: both read an
 * empty `schema_migrations`, both run `0016`, and the loser fails the boot on a
 * duplicate key — a deploy that fails for a reason that has nothing to do with
 * the deploy. The lock is session-scoped and released on disconnect, so a
 * process killed mid-migration does not leave it held.
 *
 * The number is arbitrary and permanent; it only has to be unique to this use.
 */
const MIGRATION_LOCK_KEY = 8_531_204_117;

interface AppliedMigration {
  readonly name: string;
  readonly checksum: string;
}

/** Every migration shipped alongside this runner, in the order they apply. */
async function migrationFiles(): Promise<string[]> {
  return (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

async function ensureMigrationsTable(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `;
}

function checksum(content: string): string {
  // Normalise line endings so a Windows checkout does not look like a changed file.
  return createHash('sha256').update(content.replace(/\r\n/g, '\n')).digest('hex');
}

export async function runMigrations(connectionString: string): Promise<{ applied: string[] }> {
  const sql = postgres(connectionString, {
    max: 1,
    // A managed Postgres refuses a plaintext connection; a local container has
    // no certificate to offer. See shouldUseSsl for how this is decided.
    ssl: shouldUseSsl(connectionString, process.env.DATABASE_SSL) ? 'require' : false,
    onnotice: () => {},
  });
  const applied: string[] = [];
  let locked = false;

  try {
    /*
     * Blocks rather than failing: the other holder is applying the same files,
     * and waiting for it is the correct outcome for this process too.
     *
     * Advisory locks are session-scoped, which is why migrations must use the
     * DIRECT connection string. Through a transaction-mode pooler each
     * statement can land on a different backend, so the lock would be taken on
     * one connection and the migrations run on another — and it would look
     * like it worked. That string is also what the DDL itself needs, so the
     * two requirements have one answer: DATABASE_MIGRATION_URL.
     */
    await sql`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    locked = true;

    await ensureMigrationsTable(sql);

    const files = await migrationFiles();

    const rows = await sql<AppliedMigration[]>`SELECT name, checksum FROM schema_migrations`;
    const alreadyApplied = new Map(rows.map((r) => [r.name, r.checksum]));

    for (const file of files) {
      const content = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      const hash = checksum(content);
      const previous = alreadyApplied.get(file);

      if (previous) {
        // An edited migration means the deployed schema and the repository have
        // diverged. Refusing here is safer than applying a partial fix-up.
        if (previous !== hash) {
          throw new Error(
            `Migration ${file} has changed since it was applied.\n` +
              `  applied checksum: ${previous}\n  current checksum: ${hash}\n` +
              'Add a new migration instead of editing an applied one.',
          );
        }
        continue;
      }

      // Each migration is atomic: a failure halfway leaves no partial schema.
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`INSERT INTO schema_migrations (name, checksum) VALUES (${file}, ${hash})`;
      });
      applied.push(file);
      console.log(`  applied ${file}`);
    }

    return { applied };
  } finally {
    /*
     * Released explicitly rather than left to the disconnect. Ending the
     * connection does release it, but only once the server notices — and a
     * second instance booting in the same second would wait for that instead
     * of for the work.
     */
    if (locked) {
      await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY})`.catch(() => {
        // The connection is about to close, which releases it anyway.
      });
    }
    await sql.end({ timeout: 5 });
  }
}

/** What the database has, and what this build is carrying that it has not. */
export interface MigrationStatus {
  readonly applied: readonly string[];
  /** Shipped here, absent from the database. Every one of these breaks queries. */
  readonly pending: readonly string[];
  /** Applied under a different content than the file now holds. */
  readonly changed: readonly string[];
}

/**
 * Compare the migrations in this build against the ones the database records,
 * without applying anything.
 *
 * This exists because the failure it detects has no other symptom. An API whose
 * code is newer than its schema starts cleanly, passes every health check, and
 * then answers `500` to each request that touches a column the database does
 * not have — which reads like an application bug and is not one. Asking the
 * question at boot turns a week of that into one line in the log.
 *
 * Read-only, and tolerant of a database that has never been migrated at all:
 * a missing `schema_migrations` means everything is pending, which is exactly
 * what it means.
 */
export async function migrationStatus(connectionString: string): Promise<MigrationStatus> {
  const sql = postgres(connectionString, {
    max: 1,
    ssl: shouldUseSsl(connectionString, process.env.DATABASE_SSL) ? 'require' : false,
    onnotice: () => {},
  });

  try {
    const files = await migrationFiles();

    const [table] = await sql<{ present: boolean }[]>`
      SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present
    `;

    if (!table?.present) {
      return { applied: [], pending: files, changed: [] };
    }

    const rows = await sql<AppliedMigration[]>`SELECT name, checksum FROM schema_migrations`;
    const recorded = new Map(rows.map((r) => [r.name, r.checksum]));

    const pending: string[] = [];
    const changed: string[] = [];

    for (const file of files) {
      const previous = recorded.get(file);
      if (previous === undefined) {
        pending.push(file);
        continue;
      }
      if (previous !== checksum(await readFile(join(MIGRATIONS_DIR, file), 'utf8'))) {
        changed.push(file);
      }
    }

    return {
      applied: [...recorded.keys()].sort((a, b) => a.localeCompare(b, 'en')),
      pending,
      changed,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

// Invoked directly via `pnpm db:migrate`.
if (process.argv[1] && /migrate\.(ts|js|mjs)$/.test(process.argv[1])) {
  /*
   * The same `.env` the API reads, and for the same reason.
   *
   * Without this the runner saw only what was exported into the shell, so
   * `pnpm db:migrate` on a machine with a perfectly good `.env` answered
   * "DATABASE_MIGRATION_URL or DATABASE_URL must be set" — and the natural
   * reading of that is that the file is wrong, not that nothing read it.
   * Real environment variables still win, so a deployment is unaffected, and
   * it refuses to read anything at all under NODE_ENV=production.
   */
  loadDotEnv();

  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_MIGRATION_URL or DATABASE_URL must be set');
    process.exit(1);
  }
  console.log('Running migrations…');
  runMigrations(url)
    .then(({ applied }) => {
      console.log(
        applied.length === 0
          ? 'Database already up to date.'
          : `Applied ${applied.length} migration(s).`,
      );
      process.exit(0);
    })
    .catch((error: unknown) => {
      console.error('Migration failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
