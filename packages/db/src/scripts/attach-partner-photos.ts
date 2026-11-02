import { and, eq, isNull } from 'drizzle-orm';
import { loadDotEnv } from '@jibli/config';
import { createDatabase } from '../client.js';
import { shouldUseSsl } from '../ssl.js';
import { menuItems, restaurants } from '../schema/index.js';
import { upsertImageAsset } from '../seed/demo-images.js';

/**
 * Attach a partner's own published dish photos to its menu.
 *
 * Input is a JSON list the operator prepares from the shop's public menu —
 * `[{ name, imageUrl }]` plus an optional `cover` — and the shop's partner
 * code. Each photo is fetched once, stored as our own asset (never
 * hotlinked), and set on every item whose name matches: exactly, or as the
 * base of a split variant («بيتزا مارغريتا — كبير» takes «بيتزا مارغريتا»'s
 * photo). Names are compared after folding alef forms, taa marbuta and
 * spacing, since the two menus spell the same dish slightly differently.
 *
 *     DATABASE_URL=… pnpm --filter @jibli/db exec tsx src/scripts/attach-partner-photos.ts \
 *       PARTNER-HDT-1010 photos.json
 */

interface PhotoList {
  readonly cover?: string;
  readonly photos: readonly { readonly name: string; readonly imageUrl: string }[];
}

function fold(name: string): string {
  return name
    // Persian letterforms the menu site uses, and Arabic-Indic digits.
    .replace(/[یى]/g, 'ي')
    .replace(/[کگ]/g, 'ك')
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    // A bracketed gloss («(سبايسي)», «(مشروم)») is spelled differently on
    // each side and adds nothing the name does not already say.
    .replace(/\([^)]*\)/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ـً-ْ]/g, '')
    .replace(/ساندوتش/g, 'ساندويش')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  const [partnerCode, listPath] = process.argv.slice(2);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !partnerCode || !listPath) {
    throw new Error('Usage: DATABASE_URL=… attach-partner-photos <PARTNER-CODE> <photos.json>');
  }
  const { readFile } = await import('node:fs/promises');
  const list = JSON.parse(await readFile(listPath, 'utf8')) as PhotoList;

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

    const items = await db
      .select({ id: menuItems.id, name: menuItems.nameAr })
      .from(menuItems)
      .where(and(eq(menuItems.restaurantId, shop.id), isNull(menuItems.deletedAt)));

    const byName = new Map(list.photos.map((photo) => [fold(photo.name), photo.imageUrl]));
    const cache = new Map<string, string>();
    let attached = 0;
    const unmatched: string[] = [];

    for (const item of items) {
      const full = fold(item.name);
      const base = fold(item.name.split(' — ')[0] ?? item.name);
      const url = byName.get(full) ?? byName.get(base);
      if (!url) {
        unmatched.push(item.name);
        continue;
      }
      let assetId = cache.get(url);
      if (!assetId) {
        const image = await fetchImage(url);
        const key = url.split('/').pop() ?? item.id;
        assetId = await upsertImageAsset(
          db,
          {
            storageKey: `partners/${partnerCode}/photos/${key}`,
            png: image.bytes,
            width: null,
            height: null,
            contentType: image.contentType,
          },
          shop.id,
        );
        cache.set(url, assetId);
      }
      await db
        .update(menuItems)
        .set({ imageAssetId: assetId, updatedAt: new Date() })
        .where(eq(menuItems.id, item.id));
      attached += 1;
    }

    if (list.cover) {
      const image = await fetchImage(list.cover);
      const coverAssetId = await upsertImageAsset(
        db,
        {
          storageKey: `partners/${partnerCode}/cover`,
          png: image.bytes,
          width: null,
          height: null,
          contentType: image.contentType,
        },
        shop.id,
      );
      await db
        .update(restaurants)
        .set({ coverAssetId, updatedAt: new Date() })
        .where(eq(restaurants.id, shop.id));
    }

    console.log(
      `✓ ${partnerCode}: ${attached}/${items.length} items photographed, ` +
        `${cache.size} distinct photos stored${list.cover ? ', cover set' : ''}`,
    );
    if (unmatched.length > 0) console.log('Unmatched:', unmatched.join(' | '));
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
