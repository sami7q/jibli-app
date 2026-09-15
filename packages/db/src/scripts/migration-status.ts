import { loadDotEnv } from '@jibli/config';
import { migrationStatus } from '../migrate.js';

/**
 * What this checkout is carrying that a database does not have.
 *
 * A read-only question, asked of any environment, and the one that would have
 * turned a day of "the Admin panel is broken" into a minute. Production was
 * running code that selected `restaurants.merchant_type` against a database
 * with no such column: the API started, both health checks passed, and every
 * request touching it answered `500 INTERNAL_ERROR` — a message that points at
 * the application and says nothing about the deploy.
 *
 *   DATABASE_MIGRATION_URL=… pnpm db:status
 *
 * Exits non-zero when anything is pending, so CI can gate a release on it.
 */
async function main(): Promise<void> {
  // Same `.env` the API reads; real environment variables still win.
  loadDotEnv();

  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_MIGRATION_URL or DATABASE_URL must be set');
    process.exit(1);
  }

  const { applied, pending, changed } = await migrationStatus(url);

  console.log(`applied: ${applied.length}`);
  if (applied.length > 0) console.log(`  latest: ${applied[applied.length - 1]}`);

  if (changed.length > 0) {
    console.error(`\nchanged after being applied (${changed.length}):`);
    for (const name of changed) console.error(`  ${name}`);
    console.error(
      '\nThe deployed schema and this checkout have diverged. Add a new migration\n' +
        'rather than editing an applied one, and reconcile the difference by hand.',
    );
  }

  if (pending.length > 0) {
    console.error(`\npending (${pending.length}):`);
    for (const name of pending) console.error(`  ${name}`);
    console.error(
      '\nQueries that touch the columns these add will fail with INTERNAL_ERROR.\n' +
        'Apply them with: pnpm db:migrate',
    );
  }

  if (pending.length === 0 && changed.length === 0) {
    console.log('\nDatabase is up to date with this checkout.');
  }

  process.exit(pending.length > 0 || changed.length > 0 ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error('Could not read migration status:', error instanceof Error ? error.message : error);
  process.exit(1);
});
