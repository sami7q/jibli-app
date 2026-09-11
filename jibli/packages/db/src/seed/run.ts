import { createDatabase } from '../client.js';
import { shouldUseSsl } from '../ssl.js';
import { seedGeography, activateCity } from './geography.js';
import { seedPlatformConfig } from './platform-config.js';

/**
 * Seed runner.
 *
 * Geography master data is seeded in EVERY environment including production:
 * all 19 governorates and their canonical cities must exist before launch,
 * with every capability off until Operations activates a service area
 * (plan §9).
 *
 * Demo data — an activated city, a sample restaurant — is created only outside
 * production, because seeding a fake restaurant into a live marketplace would
 * be visible to real customers.
 */

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL must be set');
    process.exit(1);
  }

  const appEnv = process.env.APP_ENV ?? 'local';
  const { db, sql } = createDatabase({
    connectionString,
    maxConnections: 1,
    ssl: shouldUseSsl(connectionString, process.env.DATABASE_SSL),
  });

  try {
    console.log(`Seeding Jibli (${appEnv})…\n`);

    console.log('→ Iraq geography master data');
    const geography = await seedGeography(db);
    console.log(
      `  governorates: ${geography.governoratesInserted} inserted, ${geography.governoratesUpdated} updated`,
    );
    console.log(
      `  cities:       ${geography.citiesInserted} inserted, ${geography.citiesUpdated} updated`,
    );
    if (geography.orphanedCityCodes.length > 0) {
      // Reported, never deleted: historical orders may reference them (plan §9).
      console.warn(
        `  ⚠ ${geography.orphanedCityCodes.length} city row(s) are no longer in the dataset ` +
          `and were left untouched: ${geography.orphanedCityCodes.join(', ')}`,
      );
    }

    console.log('\n→ Platform configuration defaults');
    const config = await seedPlatformConfig(db);
    console.log(`  ${config.inserted} key(s) inserted, ${config.existing} already set`);

    if (appEnv === 'production') {
      console.log(
        '\n✓ Production seed complete. All geography capabilities remain OFF — ' +
          'activate launch cities from the Admin Portal.',
      );
    } else {
      // Local and staging get Baghdad opened so a developer can place an order
      // on a fresh database without hunting through the Admin UI first.
      console.log('\n→ Development: activating Baghdad for all capabilities');
      await activateCity(db, 'IQ-BG-BAGHDAD', {
        customerSignup: true,
        restaurantOnboarding: true,
        ordering: true,
      });
      console.log('  IQ-BG-BAGHDAD is open for signup, onboarding and ordering');
      console.log('\n✓ Seed complete.');
    }
  } catch (error) {
    console.error('\n✗ Seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main();
