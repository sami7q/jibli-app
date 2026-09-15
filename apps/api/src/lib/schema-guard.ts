import { migrationStatus, runMigrations } from '@jibli/db/migrate';
import type { ApiEnv } from '@jibli/config';
import type { Logger } from '@jibli/logger';

/**
 * Does the database this process is about to serve actually have the schema
 * this build was written against?
 *
 * The question is asked because the answer was "no" in production for a day
 * and nothing said so. Migrations `0016` and `0017` added `merchant_type` to
 * `restaurants`, `app_categories` and `app_banners`; the code that reads those
 * columns was deployed and the migrations were not. The API started, passed
 * liveness, passed readiness, and returned `500 INTERNAL_ERROR` to every
 * request that touched one of them — the customer app's home screen, the
 * restaurant portal's own shell, and the Admin directory. From the outside it
 * looked like an application bug, and every hour spent reading route code was
 * an hour spent in the wrong file.
 *
 * Nothing here is clever. It reads `schema_migrations`, compares it against the
 * `.sql` files shipped in this same artifact, and refuses to be quiet about a
 * difference. That is the whole mechanism, and the reason it is worth its
 * fifty lines is that the failure it names is invisible without it.
 */

export interface SchemaState {
  /** False when the database is behind this build. Readiness reports it. */
  readonly ok: boolean;
  /** True when the check ran at all — a checker that cannot run says so. */
  readonly checked: boolean;
  readonly pending: readonly string[];
  readonly changed: readonly string[];
}

const HEALTHY: SchemaState = { ok: true, checked: true, pending: [], changed: [] };

/**
 * Migrations use their own credential.
 *
 * On Neon the runtime string is the pooled one, and the pooler runs in
 * transaction mode where session-level DDL statements fail with errors that
 * read like a permissions problem. `DATABASE_MIGRATION_URL` is the direct
 * string. Falling back to the runtime one is better than not checking at all —
 * reading `schema_migrations` works fine through a pooler either way.
 */
function migrationUrl(env: ApiEnv): string {
  return env.DATABASE_MIGRATION_URL ?? env.DATABASE_URL;
}

export async function ensureSchema(env: ApiEnv, logger: Logger): Promise<SchemaState> {
  let status;
  try {
    status = await migrationStatus(migrationUrl(env));
  } catch (error) {
    /*
     * The checker failing is not the database failing. A local run from a
     * directory with no `migrations/` beside it lands here, and that must not
     * stop the API — it would turn a diagnostic into an outage of its own.
     */
    logger.warn(
      { event: 'schema.check_failed', err: error instanceof Error ? error.message : String(error) },
      'Could not compare the database schema against this build',
    );
    return { ok: true, checked: false, pending: [], changed: [] };
  }

  if (status.pending.length === 0 && status.changed.length === 0) {
    logger.info(
      { event: 'schema.up_to_date', applied: status.applied.length },
      `Database schema is current (${status.applied.length} migrations applied)`,
    );
    return HEALTHY;
  }

  /*
   * A migration whose *content* changed after it was applied is not something
   * to fix automatically. It means the deployed schema and the repository have
   * diverged in a way only a person can reconcile, so it is reported and the
   * instance is marked unhealthy rather than guessed at.
   */
  if (status.changed.length > 0) {
    logger.error(
      { event: 'schema.migration_changed', changed: status.changed },
      `Migration(s) were edited after being applied: ${status.changed.join(', ')}. ` +
        'The deployed schema and this build have diverged; reconcile them by hand.',
    );
  }

  if (status.pending.length > 0 && env.RUN_MIGRATIONS_ON_BOOT) {
    logger.warn(
      { event: 'schema.migrating', pending: status.pending },
      `Applying ${status.pending.length} pending migration(s) before serving traffic`,
    );

    try {
      const { applied } = await runMigrations(migrationUrl(env));
      logger.info(
        { event: 'schema.migrated', applied },
        `Applied ${applied.length} migration(s): ${applied.join(', ')}`,
      );
      return status.changed.length > 0 ? { ...HEALTHY, ok: false, changed: status.changed } : HEALTHY;
    } catch (error) {
      logger.error(
        { event: 'schema.migrate_failed', err: error instanceof Error ? error.message : String(error) },
        'Migrations failed; the API is serving a database older than its code',
      );
    }
  }

  if (status.pending.length > 0) {
    /*
     * Loud, and specific about the consequence. "Pending migrations" is a
     * status; "requests touching the new columns will return 500" is what the
     * person reading the log is actually seeing.
     */
    logger.error(
      { event: 'schema.behind', pending: status.pending },
      `Database is missing ${status.pending.length} migration(s): ${status.pending.join(', ')}. ` +
        'Requests that touch the columns they add will fail with INTERNAL_ERROR until ' +
        '`pnpm db:migrate` is run against this database.',
    );
  }

  return { ok: false, checked: true, pending: status.pending, changed: status.changed };
}
