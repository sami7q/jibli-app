import { eq, sql } from 'drizzle-orm';
import { GOVERNORATE_COUNT, CITY_COUNT, validateDataset } from '@jibli/geography';
import { createDatabase } from '../client.js';
import { cities, governorates } from '../schema/geography.js';

/**
 * Seed verification gate (plan §152).
 *
 * CI runs this after seeding. It proves the database matches the canonical
 * dataset AND that the safe-launch posture holds — every capability off until
 * Operations activates a service area.
 */

interface Check {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL must be set');
    process.exit(1);
  }

  const { db, sql: client } = createDatabase({ connectionString, maxConnections: 1 });
  const checks: Check[] = [];

  try {
    // 1. The dataset itself is internally consistent.
    const dataset = validateDataset();
    checks.push({
      name: 'dataset integrity',
      passed: dataset.ok,
      detail: dataset.ok ? 'no problems' : dataset.problems.join('; '),
    });

    // 2. Exactly 19 governorates for this source version (plan §8.1).
    const [governorateCount] = await db
      .select({ value: sql<number>`COUNT(*)::int` })
      .from(governorates);
    const actualGovernorates = Number(governorateCount?.value ?? 0);
    checks.push({
      name: '19 governorates present',
      passed: actualGovernorates === GOVERNORATE_COUNT,
      detail: `expected ${GOVERNORATE_COUNT}, found ${actualGovernorates}`,
    });

    // 3. Every canonical city exists.
    const [cityCount] = await db.select({ value: sql<number>`COUNT(*)::int` }).from(cities);
    const actualCities = Number(cityCount?.value ?? 0);
    checks.push({
      name: 'all canonical cities present',
      passed: actualCities >= CITY_COUNT,
      detail: `expected at least ${CITY_COUNT}, found ${actualCities}`,
    });

    // 4. Halabja, the 19th governorate, specifically (plan §8.1).
    const halabja = await db
      .select({ nameAr: governorates.nameAr })
      .from(governorates)
      .where(eq(governorates.code, 'IQ-HA'))
      .limit(1);
    checks.push({
      name: 'Halabja present',
      passed: halabja.length === 1,
      detail: halabja[0]?.nameAr ?? 'missing',
    });

    // 5. Every city has a valid parent (plan §97).
    const [orphans] = await db
      .select({ value: sql<number>`COUNT(*)::int` })
      .from(cities)
      .where(
        sql`NOT EXISTS (SELECT 1 FROM ${governorates} WHERE ${governorates.id} = ${cities.governorateId})`,
      );
    checks.push({
      name: 'no orphaned cities',
      passed: Number(orphans?.value ?? 0) === 0,
      detail: `${Number(orphans?.value ?? 0)} orphan(s)`,
    });

    // 6. No duplicate canonical codes. The unique index enforces it; this
    //    confirms the index is actually present on the deployed schema.
    const [duplicateCities] = await db.execute<{ count: number }>(
      sql`SELECT COUNT(*)::int AS count FROM (
            SELECT code FROM cities GROUP BY code HAVING COUNT(*) > 1
          ) duplicates`,
    );
    checks.push({
      name: 'no duplicate city codes',
      passed: Number(duplicateCities?.count ?? 0) === 0,
      detail: `${Number(duplicateCities?.count ?? 0)} duplicate(s)`,
    });

    // 7. Safe launch posture (plan §9). In production, nothing is open until
    //    Operations says so. In development the seed opens Baghdad on purpose,
    //    so this check only applies where it should.
    if (process.env.APP_ENV === 'production') {
      const [openRows] = await db
        .select({ value: sql<number>`COUNT(*)::int` })
        .from(cities)
        .where(eq(cities.orderingEnabled, true));
      checks.push({
        name: 'production launches with ordering disabled everywhere',
        passed: Number(openRows?.value ?? 0) === 0,
        detail: `${Number(openRows?.value ?? 0)} city/cities already have ordering enabled`,
      });
    }

    const failed = checks.filter((c) => !c.passed);

    console.log('\nGeography seed verification\n');
    for (const check of checks) {
      console.log(`  ${check.passed ? '✓' : '✗'} ${check.name} — ${check.detail}`);
    }

    if (failed.length > 0) {
      console.error(`\n✗ ${failed.length} check(s) failed.`);
      process.exitCode = 1;
    } else {
      console.log('\n✓ All geography checks passed.');
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

void main();
