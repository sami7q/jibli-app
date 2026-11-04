import { eq } from 'drizzle-orm';
import { loadDotEnv } from '@jibli/config';
import { createDatabase } from '../client.js';
import { shouldUseSsl } from '../ssl.js';
import { restaurantBranches, restaurants } from '../schema/index.js';

/**
 * Set a partner shop's phone and, optionally, its address — nothing else.
 *
 * Re-running the provisioning upsert would do it too, but would also reset
 * the menu to the seed and undo anything the shop changed itself. This
 * touches only the branch's contact fields.
 *
 *     DATABASE_URL=… pnpm --filter @jibli/db exec tsx src/scripts/set-partner-contact.ts \
 *       PARTNER-HDT-BLABAN +9647750011805 "حديثة - السبحاني"
 */
async function main(): Promise<void> {
  loadDotEnv();
  const [partnerCode, phone, address] = process.argv.slice(2);
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !partnerCode || !phone || !/^\+9647\d{9}$/.test(phone)) {
    throw new Error('Usage: DATABASE_URL=… set-partner-contact <PARTNER-CODE> <+9647XXXXXXXXX> [address]');
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

    const updated = await db
      .update(restaurantBranches)
      .set({ phone, ...(address ? { addressText: address } : {}), updatedAt: new Date() })
      .where(eq(restaurantBranches.restaurantId, shop.id))
      .returning({ id: restaurantBranches.id });

    console.log(`✓ ${partnerCode}: ${updated.length} branch(es) updated`);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
