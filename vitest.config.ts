import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Resolve a workspace package entry to an absolute path (Windows-safe). */
const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: [
      'packages/**/*.test.ts',
      'apps/api/**/*.test.ts',
      'apps/worker/**/*.test.ts',
      // The mobile client holds the single-flight token refresh and the
      // idempotency rules; it was outside the suite entirely until the app
      // foundation went in.
      'apps/mobile/**/*.test.ts',
    ],
    // The E2E suite needs a real database and has its own config
    // (vitest.e2e.config.ts); running it here would fail on resolution.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/*.e2e.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/index.ts', 'packages/db/src/schema/**'],
      thresholds: {
        // Financial and geography logic must stay heavily covered.
        'packages/money/src/**': { statements: 90, branches: 85, functions: 90, lines: 90 },
        'packages/geography/src/**': { statements: 85, branches: 80, functions: 85, lines: 85 },
      },
    },
  },
  resolve: {
    alias: {
      '@jibli/config': pkg('config'),
      '@jibli/logger': pkg('logger'),
      '@jibli/money': pkg('money'),
      '@jibli/validation/arabic': fileURLToPath(
        new URL('./packages/validation/src/arabic.ts', import.meta.url),
      ),
      '@jibli/validation/phone': fileURLToPath(
        new URL('./packages/validation/src/phone.ts', import.meta.url),
      ),
      '@jibli/validation/names': fileURLToPath(
        new URL('./packages/validation/src/names.ts', import.meta.url),
      ),
      '@jibli/validation': pkg('validation'),
      '@jibli/contracts': pkg('contracts'),
      '@jibli/db': pkg('db'),
      '@jibli/auth': pkg('auth'),
      '@jibli/geography': pkg('geography'),
      '@jibli/domain': pkg('domain'),
      '@jibli/notifications': pkg('notifications'),
      '@jibli/design-tokens': pkg('design-tokens'),
    },
  },
});
