import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { shouldUseSsl } from './ssl.js';

/**
 * Migration runner.
 *
 * Plain SQL files applied in filename order, each inside its own transaction,
 * recorded with a checksum. Migrations run with DATABASE_MIGRATION_URL — a more
 * privileged credential than the application runtime user (plan §7).
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

interface AppliedMigration {
  readonly name: string;
  readonly checksum: string;
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

  try {
    await ensureMigrationsTable(sql);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, 'en'));

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
    await sql.end({ timeout: 5 });
  }
}

// Invoked directly via `pnpm db:migrate`.
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
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
