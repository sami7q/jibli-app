import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { eq } from 'drizzle-orm';
import { loadDotEnv } from '@jibli/config';
import { createDatabase } from '../client.js';
import { shouldUseSsl } from '../ssl.js';
import { restaurants } from '../schema/index.js';
import { upsertImageAsset } from '../seed/demo-images.js';

/**
 * Replace a partner shop's logo and, optionally, its cover — nothing else.
 *
 * Each picture is stored under a key derived from its file name, so a new
 * logo becomes a new asset with a new URL: phones that cached the old one by
 * URL fetch the new one instead of showing the old logo until their cache
 * expires. The menu is untouched, unlike re-running the provisioning upsert.
 *
 *     DATABASE_URL=… pnpm --filter @jibli/db exec tsx src/scripts/set-partner-images.ts \
 *       PARTNER-HDT-1010 path/to/logo.jpg [path/to/cover.jpg]
 */
async function store(
  db: Parameters<typeof upsertImageAsset>[0],
  partnerCode: string,
  restaurantId: string,
  path: string,
): Promise<string> {
  return upsertImageAsset(
    db,
    {
      storageKey: `partners/${partnerCode}/${basename(path)}`,
      png: await readFile(path),
      width: null,
      height: null,
      contentType: path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg',
    },
    restaurantId,
  );
}

async function main(): Promise<void> {
  loadDotEnv();
  const [partnerCode, logoPath, coverPath] = process.argv.slice(2);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !partnerCode || !logoPath) {
    throw new Error('Usage: DATABASE_URL=… set-partner-images <PARTNER-CODE> <logo> [cover]');
  }

  const { db, sql } = createDatabase({
    connectionString,
    maxConnections: 1,
    ssl: shouldUseSsl(connectionString, process.env.DATABASE_SSL),
  });

  try {
    const [shop] = await db
      .select({ id: restaurants.id })
      .from(restaurants)
      .where(eq(restaurants.partnerCode, partnerCode))
      .limit(1);
    if (!shop) throw new Error(`No shop ${partnerCode}`);

    const logoAssetId = await store(db, partnerCode, shop.id, logoPath);
    const coverAssetId = coverPath ? await store(db, partnerCode, shop.id, coverPath) : undefined;
    await db
      .update(restaurants)
      .set({ logoAssetId, ...(coverAssetId ? { coverAssetId } : {}), updatedAt: new Date() })
      .where(eq(restaurants.id, shop.id));

    console.log(`✓ ${partnerCode}: logo${coverAssetId ? ' and cover' : ''} replaced`);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
