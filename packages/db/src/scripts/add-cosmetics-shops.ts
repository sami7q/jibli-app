import { eq } from 'drizzle-orm';
import { loadDotEnv } from '@jibli/config';
import { generatePortalPassword, hashPassword } from '@jibli/auth';
import { createDatabase } from '../client.js';
import { shouldUseSsl } from '../ssl.js';
import { cities } from '../schema/index.js';
import { DEMO_COSMETICS, upsertDemoShop, type ShopSeedCounts } from '../seed/demo-marketplace.js';

/**
 * Add the sample cosmetics shops to one database, and nothing else.
 *
 * The full demo seed refuses production, rightly — it would put twelve fake
 * restaurants in front of real customers. This adds only the cosmetics shops
 * (two in Baghdad, one in Haditha) so the new section has something in it,
 * through the same `upsertDemoShop` the seed uses. They keep the `DEMO-`
 * partner code, so `pnpm db:remove-demo` takes them out again.
 *
 * Each owner gets a fresh random portal password, printed once at the end.
 * Running it again refreshes the shops and issues new passwords.
 *
 *     DATABASE_URL=<target> pnpm --filter @jibli/db add-cosmetics -- --confirm
 */

const DEFAULT_CITY = 'IQ-BG-BAGHDAD';

function describeTarget(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return `${url.host}${url.pathname}${local ? '  (local)' : '  ← REMOTE'}`;
  } catch {
    return 'unparseable DATABASE_URL';
  }
}

async function main(): Promise<void> {
  loadDotEnv();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL must be set');
    process.exit(1);
  }

  console.log(`Target: ${describeTarget(connectionString)}`);
  console.log(`Shops:  ${DEMO_COSMETICS.map((shop) => shop.name).join('، ')}\n`);

  if (!process.argv.includes('--confirm')) {
    console.log('Dry run. Re-run with --confirm to write.');
    return;
  }

  const { db, sql: client } = createDatabase({
    connectionString,
    maxConnections: 1,
    ssl: shouldUseSsl(connectionString, process.env.DATABASE_SSL),
  });

  const counts: ShopSeedCounts = {
    restaurantsInserted: 0,
    restaurantsUpdated: 0,
    branches: 0,
    categories: 0,
    items: 0,
    modifierGroups: 0,
    owners: 0,
    images: 0,
    banners: 0,
  };
  const issued: { shop: string; city: string; username: string; password: string }[] = [];

  try {
    for (const shop of DEMO_COSMETICS) {
      const code = shop.cityCode ?? DEFAULT_CITY;
      const [city] = await db
        .select({
          id: cities.id,
          governorateId: cities.governorateId,
          nameAr: cities.nameAr,
          orderingEnabled: cities.orderingEnabled,
        })
        .from(cities)
        .where(eq(cities.code, code))
        .limit(1);

      if (!city) {
        console.warn(`  ✗ ${shop.name}: city ${code} does not exist — skipped`);
        continue;
      }
      if (!city.orderingEnabled) {
        // Created anyway: the shop is ready the moment the city is opened.
        console.warn(`  ! ${shop.name}: ${city.nameAr} is not open for ordering yet`);
      }

      const password = generatePortalPassword();
      await upsertDemoShop(db, shop, city, await hashPassword(password), counts);
      issued.push({ shop: shop.name, city: city.nameAr, username: shop.ownerUsername, password });
      console.log(`  ✓ ${shop.name} — ${city.nameAr}`);
    }
  } finally {
    await client.end();
  }

  console.log(
    `\n${counts.restaurantsInserted} created, ${counts.restaurantsUpdated} refreshed, ${counts.items} products.`,
  );
  console.log('\nPortal sign-in (shown once):');
  for (const entry of issued) {
    console.log(
      `  ${entry.shop} (${entry.city})\n    username: ${entry.username}\n    password: ${entry.password}`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
