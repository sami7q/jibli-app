import { defineConfig } from 'drizzle-kit';

/**
 * Migrations use a separate, more privileged credential than the application
 * runtime user (plan §7).
 */
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_MIGRATION_URL ??
      process.env.DATABASE_URL ??
      'postgresql://jibli:jibli@localhost:5432/jibli',
  },
  verbose: true,
  strict: true,
  casing: 'snake_case',
});
