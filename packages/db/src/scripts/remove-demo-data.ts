import { and, count, eq, inArray, isNull, like, notInArray, type SQL } from 'drizzle-orm';
import { loadDotEnv } from '@jibli/config';
import { createDatabase } from '../client.js';
import { shouldUseSsl } from '../ssl.js';
import { orders, restaurantMembers, restaurants, users } from '../schema/index.js';
import { DEMO_PARTNER_PREFIX } from '../seed/demo-marketplace.js';

/**
 * Remove the demo marketplace, and nothing else.
 *
 * A database seeded for development and then used for a real pilot ends up
 * holding both: six partners called «برجر بغداد» beside the first real one, on
 * the same screen, in the same app. Deleting them by hand from Admin is a dozen
 * careful clicks against a `restrict` foreign key, and the tempting shortcut —
 * truncate everything and re-seed — takes the operator's own account and the
 * geography with it.
 *
 * So the blast radius is stated rather than assumed: only rows whose
 * `partner_code` carries the seed's own prefix. A partner created by a person
 * has a generated code and is untouched, whatever it is named.
 *
 * What is deliberately NOT removed:
 *
 *   - geography, platform configuration, categories and banners. They are
 *     master data and merchandising, not demo content; the app needs them to
 *     look like an app.
 *   - any partner an operator created.
 *   - the operator's own account.
 *
 * Dry by default. It prints what it would do and changes nothing until
 * `--confirm` is passed, because the one thing worse than demo data in
 * production is a script that removes real data on a typo.
 *
 *   DATABASE_URL=… pnpm db:remove-demo            # report
 *   DATABASE_URL=… pnpm db:remove-demo --confirm  # do it
 *
 * `--all` widens the target from the demo partners to every partner on the
 * platform — the clean slate before a launch, when every restaurant in the
 * database was created for testing. Same rules otherwise: dry by default,
 * a partner with orders behind it is archived rather than deleted, and the
 * geography, configuration and platform accounts stay.
 *
 *   DATABASE_URL=… pnpm db:remove-demo --all             # report
 *   DATABASE_URL=… pnpm db:remove-demo --all --confirm   # do it
 */

interface Verdict {
  readonly id: string;
  readonly partnerCode: string;
  readonly displayName: string;
  readonly merchantType: string;
  readonly orderCount: number;
  /** Hard delete is only safe with no order history behind it. */
  readonly action: 'DELETE' | 'ARCHIVE';
}

/** "localhost:5432/jibli" or "ep-xxx.eu-central-1.aws.neon.tech/jibli" — no credentials. */
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

  const confirmed = process.argv.includes('--confirm');
  const everyPartner = process.argv.includes('--all');

  /*
   * Name the target before doing anything to it.
   *
   * This script reads DATABASE_URL, and on a developer's machine that variable
   * points at whichever database they last needed — a container on localhost,
   * or the live one. Those two deserve very different levels of care and look
   * identical from the command line. Host and database name only: enough to
   * tell them apart, and never the credentials.
   */
  console.log(`Target: ${describeTarget(connectionString)}`);
  console.log(
    everyPartner
      ? 'Scope:  EVERY partner on the platform (--all)\n'
      : `Scope:  demo partners only (partner_code ${DEMO_PARTNER_PREFIX}…)\n`,
  );

  const { db, sql: client } = createDatabase({
    connectionString,
    maxConnections: 1,
    ssl: shouldUseSsl(connectionString, process.env.DATABASE_SSL),
  });

  try {
    // Already-archived partners are left alone: they are history, not clutter.
    const scope: SQL | undefined = everyPartner
      ? isNull(restaurants.deletedAt)
      : like(restaurants.partnerCode, `${DEMO_PARTNER_PREFIX}%`);

    const demo = await db
      .select({
        id: restaurants.id,
        partnerCode: restaurants.partnerCode,
        displayName: restaurants.displayName,
        merchantType: restaurants.merchantType,
      })
      .from(restaurants)
      .where(scope);

    if (demo.length === 0) {
      console.log(everyPartner ? 'No partners found. Nothing to do.' : 'No demo partners found. Nothing to do.');
      return;
    }

    /*
     * An order is real history even when the restaurant on it was fake: it has
     * a customer, a courier, a commission and a ledger entry behind it. The
     * `restrict` foreign key says so, and the right answer to it is to archive
     * the partner rather than to force the delete through.
     */
    const verdicts: Verdict[] = [];
    for (const row of demo) {
      const [placed] = await db
        .select({ value: count() })
        .from(orders)
        .where(eq(orders.restaurantId, row.id));

      const orderCount = Number(placed?.value ?? 0);
      verdicts.push({ ...row, orderCount, action: orderCount === 0 ? 'DELETE' : 'ARCHIVE' });
    }

    console.log(`${everyPartner ? 'Partners' : 'Demo partners'} found: ${verdicts.length}\n`);
    for (const v of verdicts) {
      const note = v.action === 'DELETE' ? 'delete' : `archive — ${v.orderCount} order(s) behind it`;
      console.log(`  ${v.partnerCode.padEnd(10)} ${v.merchantType.padEnd(10)} ${v.displayName}  → ${note}`);
    }

    /*
     * The accounts the seed created for those partners.
     *
     * Scoped by membership rather than by a name pattern: a demo owner is
     * whoever is a member of a demo partner and of nothing else. Someone who
     * was given a demo restaurant to try and also owns a real one keeps their
     * account.
     */
    const demoIds = verdicts.map((v) => v.id);

    const membersOfDemo = await db
      .selectDistinct({ userId: restaurantMembers.userId })
      .from(restaurantMembers)
      .where(inArray(restaurantMembers.restaurantId, demoIds));

    const membersOfReal = await db
      .selectDistinct({ userId: restaurantMembers.userId })
      .from(restaurantMembers)
      .where(notInArray(restaurantMembers.restaurantId, demoIds));

    const keep = new Set(membersOfReal.map((m) => m.userId));
    const orphanedIds = membersOfDemo.map((m) => m.userId).filter((id) => !keep.has(id));

    const orphanedOwners =
      orphanedIds.length === 0
        ? []
        : await db
            .select({ id: users.id, username: users.username, fullName: users.fullName })
            .from(users)
            .where(and(inArray(users.id, orphanedIds), isNull(users.deletedAt)));

    console.log(`\nPortal accounts belonging only to those partners: ${orphanedOwners.length}`);
    for (const owner of orphanedOwners) {
      console.log(`  ${(owner.username ?? '—').padEnd(24)} ${owner.fullName ?? ''}`);
    }

    if (!confirmed) {
      console.log('\nDry run. Nothing was changed. Re-run with --confirm to apply.');
      return;
    }

    let deleted = 0;
    let archived = 0;

    await db.transaction(async (tx) => {
      for (const v of verdicts) {
        if (v.action === 'DELETE') {
          // Branches, menus, members, hours and inventory hang off this row
          // with ON DELETE CASCADE, so one statement takes the whole partner.
          await tx.delete(restaurants).where(eq(restaurants.id, v.id));
          deleted += 1;
        } else {
          await tx
            .update(restaurants)
            .set({ deletedAt: new Date(), operationalStatus: 'SUSPENDED', updatedAt: new Date() })
            .where(eq(restaurants.id, v.id));
          archived += 1;
        }
      }

      if (orphanedOwners.length > 0) {
        /*
         * Soft-deleted, not removed. Nine tables reference a user with
         * `restrict` — a settlement they recorded, a delivery they took — and
         * a demo account that once touched one of those is history too. The
         * flag is what every query in the API already filters on, so a
         * soft-deleted account cannot sign in and appears nowhere.
         */
        await tx
          .update(users)
          .set({ deletedAt: new Date(), status: 'SUSPENDED', updatedAt: new Date() })
          .where(inArray(users.id, orphanedIds));
      }
    });

    console.log(
      `\nDone. ${deleted} partner(s) deleted, ${archived} archived, ` +
        `${orphanedOwners.length} portal account(s) disabled.`,
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
