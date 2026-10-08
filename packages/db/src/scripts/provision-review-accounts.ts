import { and, eq, isNull, sql } from 'drizzle-orm';
import { loadDotEnv } from '@jibli/config';
import { checkPasswordPolicy, hashPassword, PASSWORD_MIN_LENGTH } from '@jibli/auth';
import { normalizeUsername } from '@jibli/validation';
import { createDatabase } from '../client.js';
import { shouldUseSsl } from '../ssl.js';
import { uuidv7 } from '../ids.js';
import {
  cities,
  drivers,
  governorates,
  restaurantBranches,
  restaurantDrivers,
  restaurantMembers,
  restaurants,
  sessions,
  userAddresses,
  userPlatformRoles,
  users,
  orders,
} from '../schema/index.js';
import {
  DEMO_MARKETS,
  findCity,
  upsertDemoShop,
  type DemoRestaurant,
  type ShopSeedCounts,
} from '../seed/demo-marketplace.js';

/**
 * The accounts a Google Play reviewer signs in with — created, refreshed, or
 * switched off, from environment variables alone.
 *
 * A reviewer sits outside Iraq. They cannot receive a WhatsApp code, they do
 * not have a shop that issued them a password, and nobody hired them as a
 * courier. So each of the app's three doors gets one account made for them:
 *
 *   - a customer on the number `GOOGLE_PLAY_REVIEW_PHONE`, whose code the API
 *     fixes while `GOOGLE_PLAY_REVIEW_ENABLED` is on (see packages/config)
 *   - a market with products, whose owner signs in with
 *     `GOOGLE_PLAY_REVIEW_OWNER_USERNAME` / `_PASSWORD`
 *   - a courier of that market, who signs in with
 *     `GOOGLE_PLAY_REVIEW_DRIVER_USERNAME` / `_PASSWORD`
 *
 * None of the values is in this file. The passwords are hashed and never
 * printed; the summary at the end masks the number. Running it again updates
 * what it owns and changes nothing else, so it can be re-run before every
 * submission. `--remove` switches the three accounts and the shop off once the
 * listing is approved.
 *
 *     pnpm review:provision              # create or refresh
 *     pnpm review:provision -- --dry-run # say what would happen
 *     pnpm review:provision -- --remove  # after approval
 *
 * Nothing financial is written: no orders, no settlements. The shop is a real
 * ACTIVE market in an enabled city — that is what lets the reviewer reach
 * checkout — so it is named as what it is, in Arabic, and carries the
 * `REVIEW-GP-` partner code so it can be found again.
 */

const PARTNER_CODE = 'REVIEW-GP-1';
const CUSTOMER_NAME = 'مراجع Google Play';
const OWNER_NAME = 'مراجع Google Play — صاحب المتجر';
const DRIVER_NAME = 'مراجع Google Play — مندوب';
const ADDRESS_LABEL = 'المنزل';

interface Settings {
  readonly phone: string | undefined;
  readonly cityCode: string;
  readonly ownerUsername: string | undefined;
  readonly ownerPassword: string | undefined;
  readonly driverUsername: string | undefined;
  readonly driverPassword: string | undefined;
}

function readSettings(): Settings {
  const value = (name: string) => {
    const raw = process.env[name]?.trim();
    return raw ? raw : undefined;
  };
  return {
    phone: value('GOOGLE_PLAY_REVIEW_PHONE'),
    cityCode: value('GOOGLE_PLAY_REVIEW_CITY_CODE') ?? 'IQ-BG-BAGHDAD',
    ownerUsername: value('GOOGLE_PLAY_REVIEW_OWNER_USERNAME'),
    ownerPassword: value('GOOGLE_PLAY_REVIEW_OWNER_PASSWORD'),
    driverUsername: value('GOOGLE_PLAY_REVIEW_DRIVER_USERNAME'),
    driverPassword: value('GOOGLE_PLAY_REVIEW_DRIVER_PASSWORD'),
  };
}

function describeTarget(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return `${url.host}${url.pathname}${local ? '  (local)' : '  ← REMOTE'}`;
  } catch {
    return 'unparseable DATABASE_URL';
  }
}

/** "+964 77• ••• ••78" — the number is in the Console, not in a terminal log. */
function maskPhone(e164: string): string {
  return `${e164.slice(0, 7)}• ••• ••${e164.slice(-2)}`;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

/** A password an operator chose, held to the same policy the portals enforce. */
function assertPassword(label: string, password: string, username: string): void {
  const result = checkPasswordPolicy(password, { minLength: PASSWORD_MIN_LENGTH, username });
  if (!result.ok) {
    fail(`${label}: password refused by the policy (${result.problems.join(', ')})`);
  }
}

/** The review market: a shelf of ordinary groceries, open around the clock. */
function reviewShop(ownerUsername: string): DemoRestaurant {
  const allDay = Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((day) => [day, ['00:00', '24:00'] as const]),
  ) as Record<number, readonly [string, string]>;

  return {
    partnerCode: PARTNER_CODE,
    name: 'ماركت المراجعة',
    merchantType: 'MARKET',
    description: 'متجر تجريبي لمراجعة التطبيق. المنتجات حقيقية الشكل، والطلبات لا تُنفَّذ.',
    // The same section tags the demo markets carry, so the shop files under them.
    cuisines: DEMO_MARKETS[0]?.cuisines ?? [],
    minimumOrderIqd: 0,
    deliveryFeeIqd: 2000,
    prepMinutes: 15,
    rating: null,
    ratingCount: 0,
    address: 'شارع الكرادة داخل، بغداد',
    district: 'الكرادة',
    phone: '+9647700000000',
    ownerUsername,
    ownerName: OWNER_NAME,
    hours: allDay,
    menu: [
      {
        name: 'ألبان وأجبان',
        items: [
          { name: 'حليب طازج ١ لتر', priceIqd: 2500, popular: true },
          { name: 'لبن رائب ١ كغم', priceIqd: 3000 },
          { name: 'جبنة بيضاء ٥٠٠ غم', priceIqd: 6000 },
        ],
      },
      {
        name: 'خبز ومعجنات',
        items: [
          { name: 'صمون حجري ٦ قطع', priceIqd: 1500, popular: true },
          { name: 'خبز توست كبير', priceIqd: 2000 },
        ],
      },
      {
        name: 'مشروبات',
        items: [
          { name: 'ماء ٦ × ٥٠٠ مل', priceIqd: 2000 },
          { name: 'عصير برتقال ١ لتر', priceIqd: 3500 },
          { name: 'مشروب غازي ٣٣٠ مل', priceIqd: 1000, unavailable: true },
        ],
      },
    ],
  };
}

async function main(): Promise<void> {
  loadDotEnv();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) fail('DATABASE_URL must be set');

  const dryRun = process.argv.includes('--dry-run');
  const remove = process.argv.includes('--remove');
  const settings = readSettings();

  console.log(`Target:  ${describeTarget(connectionString)}`);
  console.log(`Mode:    ${remove ? 'remove' : dryRun ? 'dry run' : 'provision'}\n`);

  if (!settings.phone) fail('GOOGLE_PLAY_REVIEW_PHONE must be set (E.164, +9647XXXXXXXXX)');
  if (!/^\+9647\d{9}$/.test(settings.phone)) {
    fail('GOOGLE_PLAY_REVIEW_PHONE must be an Iraqi mobile in E.164, e.g. +9647XXXXXXXXX');
  }
  const phone = settings.phone;

  const ownerUsername = settings.ownerUsername
    ? normalizeUsername(settings.ownerUsername)
    : undefined;
  const driverUsername = settings.driverUsername
    ? normalizeUsername(settings.driverUsername)
    : undefined;

  if (!remove) {
    if ((ownerUsername && !settings.ownerPassword) || (!ownerUsername && settings.ownerPassword)) {
      fail('GOOGLE_PLAY_REVIEW_OWNER_USERNAME and _PASSWORD must be set together');
    }
    if (
      (driverUsername && !settings.driverPassword) ||
      (!driverUsername && settings.driverPassword)
    ) {
      fail('GOOGLE_PLAY_REVIEW_DRIVER_USERNAME and _PASSWORD must be set together');
    }
    if (driverUsername && !ownerUsername) {
      fail('A review courier needs the review shop: set the OWNER variables as well');
    }
    if (ownerUsername && settings.ownerPassword) {
      assertPassword('owner', settings.ownerPassword, ownerUsername);
    }
    if (driverUsername && settings.driverPassword) {
      assertPassword('driver', settings.driverPassword, driverUsername);
    }
    if (ownerUsername && driverUsername && ownerUsername === driverUsername) {
      fail('The owner and the courier must be different usernames');
    }
  }

  console.log(`Customer: ${maskPhone(phone)}`);
  console.log(`Owner:    ${ownerUsername ?? '(not set — shop skipped)'}`);
  console.log(`Courier:  ${driverUsername ?? '(not set — courier skipped)'}`);
  console.log(`City:     ${settings.cityCode}\n`);

  if (dryRun) {
    console.log('Dry run — nothing written.');
    return;
  }

  const { db, sql: client } = createDatabase({
    connectionString,
    maxConnections: 1,
    ssl: shouldUseSsl(connectionString, process.env.DATABASE_SSL),
  });

  try {
    if (remove) {
      await removeAll(db, phone, ownerUsername, driverUsername);
      return;
    }

    // ── The city: it must be one a customer can order in ─────────────────
    const [city] = await db
      .select({
        id: cities.id,
        code: cities.code,
        nameAr: cities.nameAr,
        governorateId: cities.governorateId,
        cityEnabled: cities.isEnabled,
        cityOrdering: cities.orderingEnabled,
        governorateEnabled: governorates.isEnabled,
        governorateOrdering: governorates.orderingEnabled,
      })
      .from(cities)
      .innerJoin(governorates, eq(cities.governorateId, governorates.id))
      .where(eq(cities.code, settings.cityCode))
      .limit(1);

    if (!city) fail(`City ${settings.cityCode} does not exist — run the geography seed first`);
    if (
      !city.cityEnabled ||
      !city.cityOrdering ||
      !city.governorateEnabled ||
      !city.governorateOrdering
    ) {
      fail(
        `City ${settings.cityCode} (${city.nameAr}) is not open for ordering. ` +
          'Enable it from Admin → الجغرافيا, or point GOOGLE_PLAY_REVIEW_CITY_CODE at an open city.',
      );
    }

    // ── The customer ─────────────────────────────────────────────────────
    const customerId = await upsertCustomer(db, phone, city.id, city.governorateId);
    await upsertAddress(db, customerId, city.id, city.governorateId, city.code);
    console.log(`✓ customer ${maskPhone(phone)} — ACTIVE, verified, profile complete, one address`);

    // ── The shop and its owner ───────────────────────────────────────────
    let restaurantId: string | undefined;
    if (ownerUsername && settings.ownerPassword) {
      const shopCity = await findCity(db, settings.cityCode);
      if (!shopCity) fail(`City ${settings.cityCode} vanished mid-run`);

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
      await upsertDemoShop(
        db,
        reviewShop(ownerUsername),
        shopCity,
        await hashPassword(settings.ownerPassword),
        counts,
      );

      // The seed's upsert leaves an existing owner's flags alone; a reviewer
      // must not meet a forced password change or an MFA prompt.
      await db
        .update(users)
        .set({
          mustChangePassword: false,
          mfaEnabledAt: null,
          mfaSecretEncrypted: null,
          mfaPendingSecretEncrypted: null,
          mfaPendingStartedAt: null,
          failedLoginCount: 0,
          lockedUntil: null,
          passwordChangedAt: new Date(),
          deletedAt: null,
          updatedAt: new Date(),
        })
        .where(sql`lower(${users.username}) = ${ownerUsername}`);

      const [shop] = await db
        .select({ id: restaurants.id })
        .from(restaurants)
        .where(eq(restaurants.partnerCode, PARTNER_CODE))
        .limit(1);
      restaurantId = shop?.id;
      console.log(
        `✓ shop «ماركت المراجعة» (${PARTNER_CODE}) — ACTIVE in ${city.nameAr}, ${counts.items} products, owner ${ownerUsername}`,
      );
    } else {
      console.log('· shop skipped (no owner variables)');
    }

    // ── The courier ──────────────────────────────────────────────────────
    if (driverUsername && settings.driverPassword && restaurantId) {
      await upsertDriver(
        db,
        driverUsername,
        await hashPassword(settings.driverPassword),
        restaurantId,
      );
      console.log(`✓ courier ${driverUsername} — ACTIVE, attached to the review shop`);
    } else if (!driverUsername) {
      console.log('· courier skipped (no driver variables)');
    }

    console.log(
      '\nDone. Switch the fixed code on with GOOGLE_PLAY_REVIEW_ENABLED=true on the API, ' +
        'and paste the Console text from docs/operations/google-play-review-access.md.',
    );
  } finally {
    await client.end();
  }
}

type Db = ReturnType<typeof createDatabase>['db'];

/**
 * The review customer: a real, complete customer account on the review number
 * and nothing more — never a portal account, never staff.
 */
async function upsertCustomer(
  db: Db,
  phone: string,
  cityId: string,
  governorateId: string,
): Promise<string> {
  const now = new Date();
  const [existing] = await db
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      phoneVerifiedAt: users.phoneVerifiedAt,
      profileCompletedAt: users.profileCompletedAt,
    })
    .from(users)
    .where(eq(users.phoneE164, phone))
    .limit(1);

  if (existing) {
    /*
     * A number that already belongs to somebody is refused unless it is
     * already the review account. Updating it would rename a real customer
     * and point their profile at the review address — on a database the
     * script has no other way to tell apart from a fresh one.
     *
     * One exception: the empty account a sign-in leaves behind. Review mode
     * is switched on on the API before this script runs, and anyone who tries
     * the review number in between creates an identity with no name, no
     * completed profile and no orders. That is not somebody's account; it is
     * this one, unfinished, and refusing it would leave review access stuck.
     */
    const [anyOrder] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.userId, existing.id))
      .limit(1);
    const isEmptyStub =
      existing.fullName === null && existing.profileCompletedAt === null && !anyOrder;
    if (existing.fullName !== CUSTOMER_NAME && !isEmptyStub) {
      fail(
        'The review number already belongs to an account that is not the review customer. ' +
          'Pick a number nobody uses.',
      );
    }
    if (existing.username) {
      fail(
        'The review number belongs to an account with a username — a staff or portal account. ' +
          'Pick a number that is not in use.',
      );
    }
    const [staff] = await db
      .select({ id: userPlatformRoles.id })
      .from(userPlatformRoles)
      .where(and(eq(userPlatformRoles.userId, existing.id), isNull(userPlatformRoles.revokedAt)))
      .limit(1);
    const [member] = await db
      .select({ id: restaurantMembers.id })
      .from(restaurantMembers)
      .where(and(eq(restaurantMembers.userId, existing.id), eq(restaurantMembers.isActive, true)))
      .limit(1);
    if (staff || member) {
      fail('The review number is attached to platform roles or a shop. Pick another number.');
    }

    await db
      .update(users)
      .set({
        fullName: CUSTOMER_NAME,
        status: 'ACTIVE',
        phoneVerifiedAt: existing.phoneVerifiedAt ?? now,
        profileCompletedAt: existing.profileCompletedAt ?? now,
        profileGovernorateId: governorateId,
        profileCityId: cityId,
        preferredLanguage: 'AR',
        // A customer has no password; the code is the only key.
        passwordHash: null,
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
        deletedAt: null,
        updatedAt: now,
      })
      .where(eq(users.id, existing.id));
    return existing.id;
  }

  const id = uuidv7();
  await db.insert(users).values({
    id,
    phoneE164: phone,
    phoneVerifiedAt: now,
    fullName: CUSTOMER_NAME,
    profileGovernorateId: governorateId,
    profileCityId: cityId,
    preferredLanguage: 'AR',
    profileCompletedAt: now,
    status: 'ACTIVE',
  });
  return id;
}

/** One saved address, so checkout has something to deliver to. */
async function upsertAddress(
  db: Db,
  userId: string,
  cityId: string,
  governorateId: string,
  cityCode: string,
): Promise<void> {
  const [existing] = await db
    .select({ id: userAddresses.id })
    .from(userAddresses)
    .where(
      and(
        eq(userAddresses.userId, userId),
        eq(userAddresses.label, ADDRESS_LABEL),
        isNull(userAddresses.deletedAt),
      ),
    )
    .limit(1);

  // A point only where it is known to be inside the city; elsewhere the
  // address stands on its text, as a customer's can.
  const inBaghdad = cityCode === 'IQ-BG-BAGHDAD';
  const values = {
    label: ADDRESS_LABEL,
    governorateId,
    cityId,
    districtText: 'الكرادة',
    street: 'شارع ٦٢',
    building: 'عمارة ٤',
    floor: '٢',
    landmark: 'قرب صيدلية النور',
    latitude: inBaghdad ? 33.3128 : null,
    longitude: inBaghdad ? 44.3925 : null,
    deliveryNotes: 'حساب مراجعة — لا يوجد مستلم حقيقي',
    isDefault: true,
    deletedAt: null,
    updatedAt: new Date(),
  };

  if (existing) {
    await db.update(userAddresses).set(values).where(eq(userAddresses.id, existing.id));
  } else {
    await db.insert(userAddresses).values({ id: uuidv7(), userId, ...values });
  }
}

/**
 * The review courier: a username-and-password account with an ACTIVE driver
 * profile, hired by the review shop. Nothing else about it is real — no
 * phone, no vehicle plate, no location.
 */
async function upsertDriver(
  db: Db,
  username: string,
  passwordHash: string,
  restaurantId: string,
): Promise<void> {
  const now = new Date();

  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(sql`lower(${users.username}) = ${username}`, isNull(users.deletedAt)))
    .limit(1);

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    await db
      .update(users)
      .set({
        fullName: DRIVER_NAME,
        passwordHash,
        passwordChangedAt: now,
        mustChangePassword: false,
        mfaEnabledAt: null,
        mfaSecretEncrypted: null,
        mfaPendingSecretEncrypted: null,
        mfaPendingStartedAt: null,
        failedLoginCount: 0,
        lockedUntil: null,
        status: 'ACTIVE',
        updatedAt: now,
      })
      .where(eq(users.id, userId));
  } else {
    userId = uuidv7();
    await db.insert(users).values({
      id: userId,
      username,
      fullName: DRIVER_NAME,
      passwordHash,
      passwordChangedAt: now,
      mustChangePassword: false,
      status: 'ACTIVE',
    });
  }

  const [existingDriver] = await db
    .select({ id: drivers.id })
    .from(drivers)
    .where(eq(drivers.userId, userId))
    .limit(1);

  let driverId: string;
  if (existingDriver) {
    driverId = existingDriver.id;
    await db
      .update(drivers)
      .set({
        status: 'ACTIVE',
        availability: 'OFFLINE',
        activatedAt: now,
        suspendedAt: null,
        suspendedReason: null,
        updatedAt: now,
      })
      .where(eq(drivers.id, driverId));
  } else {
    driverId = uuidv7();
    await db.insert(drivers).values({
      id: driverId,
      userId,
      status: 'ACTIVE',
      availability: 'OFFLINE',
      defaultVehicleType: 'MOTORCYCLE',
      activatedAt: now,
    });
  }

  const [branch] = await db
    .select({ id: restaurantBranches.id })
    .from(restaurantBranches)
    .where(eq(restaurantBranches.restaurantId, restaurantId))
    .limit(1);

  const [link] = await db
    .select({ id: restaurantDrivers.id })
    .from(restaurantDrivers)
    .where(
      and(
        eq(restaurantDrivers.restaurantId, restaurantId),
        eq(restaurantDrivers.driverId, driverId),
      ),
    )
    .limit(1);

  if (link) {
    await db
      .update(restaurantDrivers)
      .set({
        isActive: true,
        deactivatedAt: null,
        canCollectCash: true,
        branchId: branch?.id ?? null,
      })
      .where(eq(restaurantDrivers.id, link.id));
  } else {
    await db.insert(restaurantDrivers).values({
      id: uuidv7(),
      restaurantId,
      branchId: branch?.id ?? null,
      driverId,
      canCollectCash: true,
      isActive: true,
      internalNote: 'Google Play review courier',
    });
  }
}

/**
 * After approval: the accounts stop signing in and the shop leaves the
 * storefront. Rows are kept — deactivated, suspended — so nothing that
 * referenced them breaks and a later review can switch them back on.
 */
async function removeAll(
  db: Db,
  phone: string,
  ownerUsername: string | undefined,
  driverUsername: string | undefined,
): Promise<void> {
  const now = new Date();

  const deactivate = async (where: ReturnType<typeof eq>, label: string) => {
    const rows = await db
      .update(users)
      .set({ status: 'DEACTIVATED', updatedAt: now })
      .where(where)
      .returning({ id: users.id });
    for (const row of rows) {
      await db
        .update(sessions)
        .set({ revokedAt: now, revokedReason: 'REVIEW_ACCESS_REMOVED' })
        .where(and(eq(sessions.userId, row.id), isNull(sessions.revokedAt)));
    }
    console.log(rows.length > 0 ? `✓ ${label} deactivated` : `· ${label} not found`);
  };

  await deactivate(eq(users.phoneE164, phone), `customer ${maskPhone(phone)}`);
  if (ownerUsername) {
    await deactivate(
      sql`lower(${users.username}) = ${ownerUsername}` as never,
      `owner ${ownerUsername}`,
    );
  }
  if (driverUsername) {
    await deactivate(
      sql`lower(${users.username}) = ${driverUsername}` as never,
      `courier ${driverUsername}`,
    );
    await db
      .update(drivers)
      .set({ status: 'SUSPENDED', availability: 'OFFLINE', suspendedAt: now, updatedAt: now })
      .where(
        sql`${drivers.userId} IN (SELECT ${users.id} FROM ${users} WHERE lower(${users.username}) = ${driverUsername})`,
      );
  }

  const suspended = await db
    .update(restaurants)
    .set({
      operationalStatus: 'SUSPENDED',
      suspendedAt: now,
      suspendedReason: 'Google Play review finished',
      updatedAt: now,
    })
    .where(eq(restaurants.partnerCode, PARTNER_CODE))
    .returning({ id: restaurants.id });
  for (const shop of suspended) {
    await db
      .update(restaurantBranches)
      .set({ acceptsOrders: false, updatedAt: now })
      .where(eq(restaurantBranches.restaurantId, shop.id));
  }
  console.log(suspended.length > 0 ? '✓ review shop suspended' : '· review shop not found');

  console.log(
    '\nNow unset GOOGLE_PLAY_REVIEW_ENABLED, _PHONE and _OTP_CODE on the API and redeploy.',
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
