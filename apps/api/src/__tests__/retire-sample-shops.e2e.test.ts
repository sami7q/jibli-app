import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, inArray, like, notInArray } from 'drizzle-orm';
import { hashPassword } from '@jibli/auth';
import { loadApiEnv } from '@jibli/config';
import { createLogger } from '@jibli/logger';
import {
  cities,
  createDatabase,
  drivers,
  menuItems,
  providers,
  restaurantBranches,
  restaurantDrivers,
  restaurantMembers,
  restaurants,
  sessions,
  users,
  uuidv7,
  type Database,
} from '@jibli/db';
import { activateCity, seedGeography } from '@jibli/db/seed';
import { ConsolePushProvider, ConsoleSmsProvider } from '@jibli/notifications';
import {
  DEMO_COSMETICS,
  DEMO_MARKETS,
  DEMO_OWNER_CREDENTIALS,
  SAMPLE_RETIRED_REASON,
  seedDemoMarketplace,
} from '@jibli/db/seed/demo';
import { createRedis, type AppContext } from '../lib/context.js';
import { buildServer, type BuiltServer } from '../server.js';
import { startRedisStub, type RedisStub } from '../testing/redis-stub.js';

/**
 * Migration 0024, applied to a database shaped like production on the day it
 * was written: 0001–0019, the geography seed, the demo marketplace seeded under
 * a non-production APP_ENV (six restaurants whose owners sign in with the
 * password printed in the seed file), 0020–0023, the reviewer's accounts and a
 * real shop — and only then 0024.
 *
 * Its own database, like 0023's, because the sample shops need cities that the
 * shared test database never has.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDb = TEST_DATABASE_URL ? describe : describe.skip;

const SAMPLE_USERNAMES = [
  ...DEMO_OWNER_CREDENTIALS.map((owner) => owner.username),
  ...[...DEMO_MARKETS, ...DEMO_COSMETICS].map((shop) => shop.ownerUsername),
];
const SAMPLE_PASSWORD = DEMO_OWNER_CREDENTIALS[0]?.password ?? '';
const REVIEW_OWNER = { username: 'review.owner.t', password: 'Review!Owner-2026' };
const REVIEW_COURIER = { username: 'review.courier.t', password: 'Review!Courier-2026' };
const REAL_OWNER = { username: 'real.owner.t', password: 'Real!Owner-2026' };

const SOURCE = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../../packages/db/migrations',
);

interface Stage {
  readonly db: Database;
  readonly server: BuiltServer;
  readonly url: string;
  readonly migrationsDir: string;
  readonly client: ReturnType<typeof createDatabase>['sql'];
  readonly baghdadId: string;
  readonly shops: { review: string; real: string };
  readonly teardown: () => Promise<void>;
}

function copyMigrations(dir: string, accept: (name: string) => boolean): void {
  for (const name of readdirSync(SOURCE)) {
    if (name.endsWith('.sql') && accept(name)) copyFileSync(join(SOURCE, name), join(dir, name));
  }
}

async function setUp(): Promise<Stage> {
  const base = new URL(TEST_DATABASE_URL as string);
  const name = `jibli_m0024_${Date.now()}`;
  const adminUrl = Object.assign(new URL(base), { pathname: '/postgres' }).toString();
  const url = Object.assign(new URL(base), { pathname: `/${name}` }).toString();
  const { sql: admin } = createDatabase({ connectionString: adminUrl, maxConnections: 1 });
  await admin.unsafe(`CREATE DATABASE ${name}`);

  const migrationsDir = mkdtempSync(join(tmpdir(), 'jibli-m0024-'));
  copyMigrations(migrationsDir, (file) => file < '0020');
  process.env.MIGRATIONS_DIR = migrationsDir;
  const { runMigrations } = await import('@jibli/db/migrate');
  await runMigrations(url);

  const { db, sql: client } = createDatabase({ connectionString: url, maxConnections: 5 });
  await seedGeography(db);
  await activateCity(db, 'IQ-BG-BAGHDAD', {
    customerSignup: true,
    restaurantOnboarding: true,
    ordering: true,
  });
  // What `pnpm db:seed` wrote into production while it ran as staging.
  await seedDemoMarketplace(db, 'IQ-BG-BAGHDAD');

  copyMigrations(migrationsDir, (file) => file >= '0020' && file < '0024');
  await runMigrations(url);

  const [baghdad] = await db
    .select({ id: cities.id, governorateId: cities.governorateId })
    .from(cities)
    .where(eq(cities.code, 'IQ-BG-BAGHDAD'));
  if (!baghdad) throw new Error('Baghdad missing');

  const account = async (fields: Partial<typeof users.$inferInsert>): Promise<string> => {
    const id = uuidv7();
    await db.insert(users).values({ id, status: 'ACTIVE', ...fields });
    return id;
  };
  const shop = async (partnerCode: string, displayName: string): Promise<string> => {
    const providerId = uuidv7();
    await db
      .insert(providers)
      .values({ id: providerId, providerType: 'RESTAURANT', status: 'ACTIVE' });
    const id = uuidv7();
    await db.insert(restaurants).values({
      id,
      providerId,
      displayName,
      partnerCode,
      onboardingStatus: 'APPROVED',
      operationalStatus: 'ACTIVE',
      ratingAverage: 4.2,
      ratingCount: 3,
    });
    await db.insert(restaurantBranches).values({
      id: uuidv7(),
      restaurantId: id,
      name: 'الفرع',
      governorateId: baghdad.governorateId,
      cityId: baghdad.id,
      addressText: 'بغداد',
      isActive: true,
      acceptsOrders: true,
    });
    return id;
  };

  // The store reviewer's accounts, shaped as review:provision makes them.
  const review = await shop('REVIEW-GP-1', 'ماركت المراجعة');
  const reviewOwner = await account({
    username: REVIEW_OWNER.username,
    fullName: 'حساب المراجعة — صاحب المتجر',
    passwordHash: await hashPassword(REVIEW_OWNER.password),
  });
  await db
    .insert(restaurantMembers)
    .values({ id: uuidv7(), restaurantId: review, userId: reviewOwner, role: 'OWNER' });
  const reviewCourier = await account({
    username: REVIEW_COURIER.username,
    fullName: 'حساب المراجعة — مندوب',
    passwordHash: await hashPassword(REVIEW_COURIER.password),
  });
  const driverId = uuidv7();
  await db
    .insert(drivers)
    .values({ id: driverId, userId: reviewCourier, status: 'ACTIVE', availability: 'AVAILABLE' });
  await db
    .insert(restaurantDrivers)
    .values({ id: uuidv7(), restaurantId: review, driverId, isActive: true });

  // A real shop — a code no seed writes — and its owner.
  const real = await shop('RS-0001', 'مطعم حقيقي');
  const realOwner = await account({
    username: REAL_OWNER.username,
    fullName: 'مالك حقيقي',
    passwordHash: await hashPassword(REAL_OWNER.password),
  });
  await db
    .insert(restaurantMembers)
    .values({ id: uuidv7(), restaurantId: real, userId: realOwner, role: 'OWNER' });

  const redis: RedisStub = await startRedisStub();
  const env = loadApiEnv({
    NODE_ENV: 'test',
    APP_ENV: 'staging',
    DATABASE_URL: url,
    REDIS_URL: redis.url,
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    OTP_HASH_PEPPER: 'c'.repeat(44),
  });
  const logger = createLogger({ serviceName: 'api-test', environment: 'staging', level: 'silent' });
  const ctx: AppContext = {
    env,
    db,
    redis: createRedis(env, logger),
    logger,
    sms: new ConsoleSmsProvider(logger, false),
    push: new ConsolePushProvider(logger),
    schema: { ok: true, checked: true, pending: [], changed: [] },
  };
  const server = await buildServer(ctx);

  return {
    db,
    server,
    url,
    migrationsDir,
    client,
    baghdadId: baghdad.id,
    shops: { review, real },
    teardown: async () => {
      await server.realtime.close();
      await server.app.close();
      ctx.redis.disconnect();
      await redis.close();
      await client.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
      rmSync(migrationsDir, { recursive: true, force: true });
    },
  };
}

describeWithDb('migration 0024: sample shops retired', () => {
  let stage: Stage;
  let sampleUserIds: string[] = [];
  let sampleShopIds: string[] = [];
  let before: {
    otherUsers: unknown[];
    otherShops: unknown[];
    menuItems: number;
    members: unknown[];
  };

  const login = (username: string, password: string) =>
    stage.server.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username, password },
    });

  const listing = async (): Promise<string[]> => {
    const response = await stage.server.app.inject({
      method: 'GET',
      url: `/api/v1/restaurants?city_id=${stage.baghdadId}&limit=50`,
    });
    expect(response.statusCode).toBe(200);
    return (
      JSON.stringify(response.json().data)
        .match(/[0-9a-f]{8}-[0-9a-f-]{27}/g)
        ?.sort() ?? []
    );
  };

  /** Every id in the Baghdad listing: the two real-world shops are there, no sample is. */
  const expectListingWithoutSamples = async () => {
    const listed = await listing();
    expect(listed).toContain(stage.shops.real);
    expect(listed).toContain(stage.shops.review);
    expect(sampleShopIds.filter((id) => listed.includes(id))).toEqual([]);
  };

  beforeAll(async () => {
    stage = await setUp();

    sampleUserIds = (
      await stage.db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.username, SAMPLE_USERNAMES))
    ).map((row) => row.id);
    sampleShopIds = (
      await stage.db
        .select({ id: restaurants.id })
        .from(restaurants)
        .where(like(restaurants.partnerCode, 'DEMO-%'))
    ).map((row) => row.id);

    // The hole this closes: a seeded owner signs in with the password in the
    // public seed file, and the sample shops are on sale.
    expect((await login('demo.mandi', SAMPLE_PASSWORD)).statusCode).toBe(200);
    const listed = await listing();
    expect(sampleShopIds.some((id) => listed.includes(id))).toBe(true);

    before = {
      otherUsers: await stage.db
        .select()
        .from(users)
        .where(notInArray(users.id, sampleUserIds))
        .orderBy(users.id),
      otherShops: await stage.db
        .select()
        .from(restaurants)
        .where(notInArray(restaurants.id, sampleShopIds))
        .orderBy(restaurants.id),
      menuItems: (await stage.db.select({ id: menuItems.id }).from(menuItems)).length,
      members: await stage.db.select().from(restaurantMembers).orderBy(restaurantMembers.id),
    };

    copyMigrations(stage.migrationsDir, (file) => file.startsWith('0024'));
    const { runMigrations } = await import('@jibli/db/migrate');
    expect((await runMigrations(stage.url)).applied).toEqual(['0024_retire_sample_shops.sql']);
  }, 240_000);

  afterAll(async () => {
    await stage?.teardown();
  });

  it('finds every sample shop and every sample owner the seed wrote', () => {
    expect(sampleShopIds).toHaveLength(SAMPLE_USERNAMES.length);
    expect(sampleUserIds).toHaveLength(SAMPLE_USERNAMES.length);
  });

  it('suspends every sample shop, stops its orders and drops the invented rating', async () => {
    const shops = await stage.db
      .select({
        status: restaurants.operationalStatus,
        reason: restaurants.suspendedReason,
        suspendedAt: restaurants.suspendedAt,
        ratingAverage: restaurants.ratingAverage,
        ratingCount: restaurants.ratingCount,
      })
      .from(restaurants)
      .where(inArray(restaurants.id, sampleShopIds));
    expect(shops).toHaveLength(sampleShopIds.length);
    for (const shop of shops) {
      expect(shop.status).toBe('SUSPENDED');
      expect(shop.reason).toBe(SAMPLE_RETIRED_REASON);
      expect(shop.suspendedAt).not.toBeNull();
      expect(shop.ratingAverage).toBeNull();
      expect(shop.ratingCount).toBe(0);
    }

    const open = await stage.db
      .select({ id: restaurantBranches.id })
      .from(restaurantBranches)
      .where(
        and(
          inArray(restaurantBranches.restaurantId, sampleShopIds),
          eq(restaurantBranches.acceptsOrders, true),
        ),
      );
    expect(open).toEqual([]);

    // A customer browsing Baghdad sees the review market and the real shop only.
    await expectListingWithoutSamples();
  });

  it('keeps the products and memberships, and leaves every other shop alone', async () => {
    expect((await stage.db.select({ id: menuItems.id }).from(menuItems)).length).toBe(
      before.menuItems,
    );
    expect(await stage.db.select().from(restaurantMembers).orderBy(restaurantMembers.id)).toEqual(
      before.members,
    );
    expect(
      await stage.db
        .select()
        .from(restaurants)
        .where(notInArray(restaurants.id, sampleShopIds))
        .orderBy(restaurants.id),
    ).toEqual(before.otherShops);
  });

  it('switches off every sample login and signs it out', async () => {
    const rows = await stage.db
      .select({ status: users.status, passwordHash: users.passwordHash })
      .from(users)
      .where(inArray(users.id, sampleUserIds));
    expect(rows.every((row) => row.status === 'DEACTIVATED' && row.passwordHash === null)).toBe(
      true,
    );
    expect(
      await stage.db.select().from(sessions).where(inArray(sessions.userId, sampleUserIds)),
    ).toEqual([]);

    const refused = await login('demo.mandi', SAMPLE_PASSWORD);
    expect(refused.statusCode).toBe(401);
    expect(refused.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('does not touch any other account, the reviewer accounts included', async () => {
    expect(
      await stage.db
        .select()
        .from(users)
        .where(notInArray(users.id, sampleUserIds))
        .orderBy(users.id),
    ).toEqual(before.otherUsers);

    expect((await login(REVIEW_OWNER.username, REVIEW_OWNER.password)).statusCode).toBe(200);
    expect((await login(REVIEW_COURIER.username, REVIEW_COURIER.password)).statusCode).toBe(200);
    expect((await login(REAL_OWNER.username, REAL_OWNER.password)).statusCode).toBe(200);
  });

  it('stays retired when the demo seed runs against the same database again', async () => {
    await seedDemoMarketplace(stage.db, 'IQ-BG-BAGHDAD');

    const shops = await stage.db
      .select({ status: restaurants.operationalStatus })
      .from(restaurants)
      .where(inArray(restaurants.id, sampleShopIds));
    expect(shops.every((shop) => shop.status === 'SUSPENDED')).toBe(true);

    const owners = await stage.db
      .select({ status: users.status, passwordHash: users.passwordHash })
      .from(users)
      .where(inArray(users.id, sampleUserIds));
    expect(owners.every((row) => row.status === 'DEACTIVATED' && row.passwordHash === null)).toBe(
      true,
    );
    expect((await login('demo.mandi', SAMPLE_PASSWORD)).statusCode).toBe(401);
    await expectListingWithoutSamples();
  });

  it('is applied once, and the file itself is safe to run again', async () => {
    const { runMigrations } = await import('@jibli/db/migrate');
    expect((await runMigrations(stage.url)).applied).toEqual([]);

    const file = readFileSync(join(SOURCE, '0024_retire_sample_shops.sql'), 'utf8');
    await stage.client.begin(async (tx) => {
      await tx.unsafe(file);
    });
    expect(
      await stage.db
        .select()
        .from(restaurants)
        .where(notInArray(restaurants.id, sampleShopIds))
        .orderBy(restaurants.id),
    ).toEqual(before.otherShops);
  });
});
