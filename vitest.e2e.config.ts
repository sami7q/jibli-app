import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * End-to-end suite (plan §145, §146).
 *
 * Runs against a real PostgreSQL database rather than a mock, because the
 * invariants under test are enforced by database constraints — a mock would
 * assert only that the test author remembered the rule.
 *
 * Requires TEST_DATABASE_URL. The suite self-skips without it so the unit tests
 * still run on a machine with no Docker.
 */

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/**/*.e2e.test.ts'],
    // Constraint violations and lock contention are slower than unit tests, and
    // the fixture runs migrations on first use.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // One file at a time: these share a database and would otherwise contend
    // for the same rows.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@jibli/config': pkg('config'),
      '@jibli/logger': pkg('logger'),
      '@jibli/money': pkg('money'),
      '@jibli/validation': pkg('validation'),
      '@jibli/contracts': pkg('contracts'),
      '@jibli/db/migrate': fileURLToPath(new URL('./packages/db/src/migrate.ts', import.meta.url)),
      '@jibli/db/seed': fileURLToPath(
        new URL('./packages/db/src/seed/geography.ts', import.meta.url),
      ),
      '@jibli/db': pkg('db'),
      '@jibli/auth': pkg('auth'),
      '@jibli/geography': pkg('geography'),
      '@jibli/domain': pkg('domain'),
      '@jibli/notifications': pkg('notifications'),
    },
  },
});
