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
import { bLaban } from '../seed/partners/b-laban.js';
import { AJEENA_LOGO_URL, ajeena } from '../seed/partners/ajeena.js';
import { LACASA_COVER_FILE, LACASA_LOGO_FILE, lacasa } from '../seed/partners/lacasa.js';
import { MR_DEEK_LOGO_FILE, mrDeek } from '../seed/partners/mrdeek.js';
import type { DemoRestaurant } from '../seed/demo-marketplace.js';

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

async function fetchImage(url: string | URL): Promise<{ bytes: Buffer; contentType: string }> {
  if (url instanceof URL && url.protocol === 'file:') {
    // A logo we hold ourselves, cropped from what the shop published.
    const { readFile } = await import('node:fs/promises');
    return { bytes: await readFile(url), contentType: 'image/jpeg' };
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') ?? 'image/png',
  };
}

/** Every real partner, with where its owner's credentials come from. */
const PARTNERS: readonly {
  readonly label: string;
  readonly build: (ownerUsername: string) => DemoRestaurant;
  readonly usernameEnv: string;
  readonly passwordEnv: string;
  readonly logoUrl?: string | URL;
  readonly coverUrl?: string | URL;
}[] = [
  {
    label: '10:10',
    build: restCafe1010,
    usernameEnv: 'PARTNER_1010_OWNER_USERNAME',
    passwordEnv: 'PARTNER_1010_OWNER_PASSWORD',
    logoUrl: REST_CAFE_1010_LOGO_URL,
  },
  {
    label: 'B.Laban',
    build: bLaban,
    usernameEnv: 'PARTNER_BLABAN_OWNER_USERNAME',
    passwordEnv: 'PARTNER_BLABAN_OWNER_PASSWORD',
  },
  {
    label: 'Ajeena',
    build: ajeena,
    usernameEnv: 'PARTNER_AJEENA_OWNER_USERNAME',
    passwordEnv: 'PARTNER_AJEENA_OWNER_PASSWORD',
    logoUrl: AJEENA_LOGO_URL,
  },
  {
    label: 'En LaCasa',
    build: lacasa,
    usernameEnv: 'PARTNER_LACASA_OWNER_USERNAME',
    passwordEnv: 'PARTNER_LACASA_OWNER_PASSWORD',
    logoUrl: LACASA_LOGO_FILE,
    coverUrl: LACASA_COVER_FILE,
  },
  {
    label: 'Mr. Deek',
    build: mrDeek,
    usernameEnv: 'PARTNER_MRDEEK_OWNER_USERNAME',
    passwordEnv: 'PARTNER_MRDEEK_OWNER_PASSWORD',
    logoUrl: MR_DEEK_LOGO_FILE,
    coverUrl: MR_DEEK_LOGO_FILE,
  },
];

async function main(): Promise<void> {
  loadDotEnv();
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL must be set');

  // Only the partners whose credentials are present: provisioning one shop
  // must not need every other shop's secrets in the environment.
  const selected = PARTNERS.filter(
    (partner) => process.env[partner.usernameEnv] && process.env[partner.passwordEnv],
  );
  if (selected.length === 0) {
    throw new Error(
      `Set at least one owner's credentials: ${PARTNERS.map((p) => p.usernameEnv).join(', ')}`,
    );
  }

  const { db, sql } = createDatabase({
    connectionString,
    maxConnections: 1,
    ssl: shouldUseSsl(connectionString, process.env.DATABASE_SSL),
  });

  try {
    for (const partner of selected) {
      const ownerUsername = normalizeUsername(process.env[partner.usernameEnv] ?? '');
      const ownerPassword = process.env[partner.passwordEnv] ?? '';
      const policy = checkPasswordPolicy(ownerPassword, {
        minLength: PASSWORD_MIN_LENGTH,
        username: ownerUsername,
      });
      if (!policy.ok) {
        throw new Error(`${partner.label}: owner password rejected: ${policy.problems.join(', ')}`);
      }

      const shop = partner.build(ownerUsername);
      const city = await findCity(db, shop.cityCode ?? '');
      if (!city) {
        throw new Error(`City ${shop.cityCode} does not exist — run the geography seed first`);
      }

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

      let logoNote = 'generated logo';
      if (partner.logoUrl) {
        // The shop's real logo in place of the generated placeholder.
        const [row] = await db
          .select({ id: restaurants.id })
          .from(restaurants)
          .where(eq(restaurants.partnerCode, shop.partnerCode))
          .limit(1);
        if (!row) throw new Error(`${shop.partnerCode} vanished after the upsert`);
        const logo = await fetchImage(partner.logoUrl);
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
        logoNote = 'real logo';
      }

      if (partner.coverUrl) {
        const [row] = await db
          .select({ id: restaurants.id })
          .from(restaurants)
          .where(eq(restaurants.partnerCode, shop.partnerCode))
          .limit(1);
        if (!row) throw new Error(`${shop.partnerCode} vanished after the upsert`);
        const cover = await fetchImage(partner.coverUrl);
        const coverAssetId = await upsertImageAsset(
          db,
          {
            storageKey: `partners/${shop.partnerCode}/cover`,
            png: cover.bytes,
            width: null,
            height: null,
            contentType: cover.contentType,
          },
          row.id,
        );
        await db
          .update(restaurants)
          .set({ coverAssetId, updatedAt: new Date() })
          .where(eq(restaurants.id, row.id));
        logoNote += ', cover';
      }

      console.log(
        `✓ ${shop.name} (${shop.partnerCode}) — ACTIVE in ${city.nameAr}: ` +
          `${counts.categories} categories, ${counts.items} items, owner ${ownerUsername}, ${logoNote}`,
      );
    }
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
