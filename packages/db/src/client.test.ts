import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from './client.js';

/**
 * `shouldUseSsl` was correct and tested. What went untested was whether
 * `createDatabase` ever asked it — and it did not: the API and worker passed
 * `env.DATABASE_SSL`, whose default is `false`, so every deployed connection to
 * Neon was attempted in plaintext and refused. The schema was applied, the
 * services booted, and readiness reported `database: false`.
 *
 * A unit test of the decision function cannot catch that. These assert on the
 * option the driver actually receives.
 */

const NEON = 'postgresql://u:p@ep-cool-forest-123.eu-central-1.aws.neon.tech/jibli';
const LOCAL = 'postgresql://jibli:jibli@localhost:5432/jibli';

const opened: { end: () => Promise<void> }[] = [];

/** postgres.js connects lazily, so this opens no socket. */
function optionsFor(connectionString: string): { ssl: unknown } {
  const { sql } = createDatabase({ connectionString });
  opened.push(sql);
  return sql.options as unknown as { ssl: unknown };
}

afterEach(async () => {
  while (opened.length > 0) await opened.pop()?.end();
  delete process.env.DATABASE_SSL;
});

describe('createDatabase() TLS', () => {
  it('requires TLS for a managed host when the caller says nothing', () => {
    expect(optionsFor(NEON).ssl).toBe('require');
  });

  it('stays plaintext for a local database', () => {
    expect(optionsFor(LOCAL).ssl).toBe(false);
  });

  it('honours DATABASE_SSL when it is actually set', () => {
    process.env.DATABASE_SSL = 'true';
    expect(optionsFor(LOCAL).ssl).toBe('require');
  });

  it('lets an explicit argument override the inference', () => {
    const { sql } = createDatabase({ connectionString: NEON, ssl: false });
    opened.push(sql);
    expect((sql.options as unknown as { ssl: unknown }).ssl).toBe(false);
  });

  it('does not let sslmode in the URL be the only thing asking for TLS', () => {
    /*
     * postgres.js resolves options as `k in o ? o[k] : query[k]`, so a passed
     * `ssl` shadows `sslmode` in the connection string completely. This pins
     * the reason the inference has to happen before the driver sees it.
     */
    const { sql } = createDatabase({
      connectionString: `${LOCAL}?sslmode=require`,
      ssl: false,
    });
    opened.push(sql);
    expect((sql.options as unknown as { ssl: unknown }).ssl).toBe(false);
  });
});
