import { eq } from 'drizzle-orm';
import { loadDotEnv } from '@jibli/config';
import { checkPasswordPolicy, hashPassword, PASSWORD_MIN_LENGTH } from '@jibli/auth';
import { normalizeUsername } from '@jibli/validation';
import { createDatabase } from '../client.js';
import { shouldUseSsl } from '../ssl.js';
import { restaurants } from '../schema/index.js';
import { findCity, upsertDemoShop, type ShopSeedCounts } from '../seed/demo-marketplace.js';
import { upsertImageAsset } from '../seed/demo-images.js';
import { REST_CAFE_1010_LOGO_URL, restCafe1010 } from '../seed/partners/rest-cafe-1010.js';

/**
 * Real partner shops whose catalogue we enter for them, from what they publish.
 *
 * The same upsert the sample shops and the review market use, so a re-run
 * updates prices and items in place instead of duplicating them, keyed on the
 * shop's partner code. The owner's portal password comes from the environment
 * and is never printed; the shop is told it out of band and changes it.
 *
 *     PARTNER_1010_OWNER_USERNAME=rest1010 \
 *     PARTNER_1010_OWNER_PASSWORD=… \
 *     pnpm --filter @jibli/db partner:provision
 */

async function fetchImage(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? 'image/png',
  };
}

async function main(): Promise<void> {
  loadDotEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL must be set');

  const ownerUsername = normalizeUsername(process.env.PARTNER_1010_OWNER_USERNAME ?? '');
  const ownerPassword = process.env.PARTNER_1010_OWNER_PASSWORD ?? '';
  if (!ownerUsername || !ownerPassword) {
    throw new Error('PARTNER_1010_OWNER_USERNAME and PARTNER_1010_OWNER_PASSWORD must be set');
  }
  const policy = checkPasswordPolicy(ownerPassword, {
    minLength: PASSWORD_MIN_LENGTH,
    username: ownerUsername,
  });
  if (!policy.ok) throw new Error(`Owner password rejected: ${policy.problems.join(', ')}`);

  const { db, sql } = createDatabase({
    connectionString,
    maxConnections: 1,
    ssl: shouldUseSsl(connectionString, process.env.DATABASE_SSL),
  });

  try {
    const shop = restCafe1010(ownerUsername);
    const city = await findCity(db, shop.cityCode ?? '');
    if (!city)
      throw new Error(`City ${shop.cityCode} does not exist — run the geography seed first`);

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
    await upsertDemoShop(db, shop, city, await hashPassword(ownerPassword), counts);

    // The shop's real logo in place of the generated placeholder.
    const [row] = await db
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(eq(restaurants.partnerCode, shop.partnerCode))
      .limit(1);
    if (!row) throw new Error(`${shop.partnerCode} vanished after the upsert`);
    const logo = await fetchImage(REST_CAFE_1010_LOGO_URL);
    const logoAssetId = await upsertImageAsset(
      db,
      {
        storageKey: `partners/${shop.partnerCode}/logo`,
        png: logo.bytes,
        width: null,
        height: null,
        contentType: logo.contentType,
      },
      row.id,
    );
    await db
      .update(restaurants)
      .set({ logoAssetId, updatedAt: new Date() })
      .where(eq(restaurants.id, row.id));

    console.log(
      `✓ ${shop.name} (${shop.partnerCode}) — ACTIVE in ${city.nameAr}: ` +
        `${counts.categories} categories, ${counts.items} items, owner ${ownerUsername}, real logo`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
