import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, inArray, like, notInArray } from 'drizzle-orm';
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
import { createRedis, type AppContext } from '../lib/context.js';
import { buildServer, type BuiltServer } from '../server.js';
import { startRedisStub, type RedisStub } from '../testing/redis-stub.js';

/**
 * Migration 0023, applied the way production meets it: 0001–0019, the
 * geography seed, then 0020 (which opens the sample shops and their owner
 * accounts), 0022, reviewer and real accounts — and only then 0023.
 *
 * Its own database, because 0020 only creates the sample shops when the cities
 * already exist, which is never true of the shared test database.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDb = TEST_DATABASE_URL ? describe : describe.skip;

const SAMPLE_USERNAMES = [
  'demo.market',
  'demo.baqala',
  'demo.haditha.market',
  'demo.cosmetics',
  'demo.perfume',
  'demo.haditha.beauty',
];
// Test-only credentials for accounts this file creates; none exists anywhere else.
const KNOWN = 'Sample!Known-2026';
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
  readonly ids: {
    reviewCustomer: string;
    reviewOwner: string;
    reviewCourier: string;
    realOwner: string;
  };
  readonly teardown: () => Promise<void>;
}

function copyMigrations(dir: string, accept: (name: string) => boolean): void {
  for (const name of readdirSync(SOURCE)) {
    if (name.endsWith('.sql') && accept(name)) copyFileSync(join(SOURCE, name), join(dir, name));
  }
}

async function setUp(): Promise<Stage> {
  const base = new URL(TEST_DATABASE_URL as string);
  const name = `jibli_m0023_${Date.now()}`;
  const adminUrl = Object.assign(new URL(base), { pathname: '/postgres' }).toString();
  const url = Object.assign(new URL(base), { pathname: `/${name}` }).toString();
  const { sql: admin } = createDatabase({ connectionString: adminUrl, maxConnections: 1 });
  await admin.unsafe(`CREATE DATABASE ${name}`);

  const migrationsDir = mkdtempSync(join(tmpdir(), 'jibli-m0023-'));
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

  // The migrations production has, the sample shops among them.
  copyMigrations(migrationsDir, (file) => file >= '0020' && file < '0023');
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
    });
    await db.insert(restaurantBranches).values({
      id: uuidv7(),
      restaurantId: id,
      name: 'الفرع',
      governorateId: baghdad.governorateId,
      cityId: baghdad.id,
      addressText: 'بغداد',
    });
    return id;
  };

  // The Google Play reviewer's three accounts, shaped as review:provision makes them.
  const reviewShop = await shop('REVIEW-GP-1', 'ماركت المراجعة');
  const reviewCustomer = await account({
    phoneE164: '+9647700000777',
    phoneVerifiedAt: new Date(),
    fullName: 'مراجع جوجل',
  });
  const reviewOwner = await account({
    username: REVIEW_OWNER.username,
    fullName: 'مالك المراجعة',
    passwordHash: await hashPassword(REVIEW_OWNER.password),
  });
  await db
    .insert(restaurantMembers)
    .values({ id: uuidv7(), restaurantId: reviewShop, userId: reviewOwner, role: 'OWNER' });
  const reviewCourier = await account({
    username: REVIEW_COURIER.username,
    fullName: 'مندوب المراجعة',
    passwordHash: await hashPassword(REVIEW_COURIER.password),
  });
  const driverId = uuidv7();
  await db
    .insert(drivers)
    .values({ id: driverId, userId: reviewCourier, status: 'ACTIVE', availability: 'AVAILABLE' });
  await db
    .insert(restaurantDrivers)
    .values({ id: uuidv7(), restaurantId: reviewShop, driverId, isActive: true });

  // A real shop and its owner.
  const realShop = await shop('RS-0001', 'مطعم حقيقي');
  const realOwner = await account({
    username: REAL_OWNER.username,
    fullName: 'مالك حقيقي',
    passwordHash: await hashPassword(REAL_OWNER.password),
  });
  await db
    .insert(restaurantMembers)
    .values({ id: uuidv7(), restaurantId: realShop, userId: realOwner, role: 'OWNER' });

  // As if someone had the sample password: proves the login worked until now.
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(KNOWN) })
    .where(eq(users.username, 'demo.market'));

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
    ids: { reviewCustomer, reviewOwner, reviewCourier, realOwner },
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

describeWithDb('migration 0023: sample shop logins switched off', () => {
  let stage: Stage;
  let sampleIds: string[] = [];
  let before: {
    restaurants: unknown[];
    menuItems: number;
    members: unknown[];
    otherUsers: unknown[];
    listing: string[];
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

  beforeAll(async () => {
    stage = await setUp();

    const sample = await stage.db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.username, SAMPLE_USERNAMES));
    sampleIds = sample.map((row) => row.id);

    // The sample login works before 0023, and leaves a session behind.
    expect((await login('demo.market', KNOWN)).statusCode).toBe(200);

    before = {
      restaurants: await stage.db.select().from(restaurants).orderBy(restaurants.id),
      menuItems: (await stage.db.select({ id: menuItems.id }).from(menuItems)).length,
      members: await stage.db.select().from(restaurantMembers).orderBy(restaurantMembers.id),
      otherUsers: await stage.db
        .select()
        .from(users)
        .where(notInArray(users.id, sampleIds))
        .orderBy(users.id),
      listing: await listing(),
    };

    copyMigrations(stage.migrationsDir, (file) => file.startsWith('0023'));
    const { runMigrations } = await import('@jibli/db/migrate');
    expect((await runMigrations(stage.url)).applied).toEqual([
      '0023_disable_sample_shop_logins.sql',
    ]);
  }, 180_000);

  afterAll(async () => {
    await stage?.teardown();
  });

  it('finds every sample account 0020 created', () => {
    expect(sampleIds).toHaveLength(SAMPLE_USERNAMES.length);
  });

  it('leaves the sample shops, their products and memberships exactly as they were', async () => {
    const sampleShops = await stage.db
      .select({ status: restaurants.operationalStatus, onboarding: restaurants.onboardingStatus })
      .from(restaurants)
      .where(like(restaurants.partnerCode, 'DEMO-%'));
    expect(sampleShops).toHaveLength(6);
    expect(
      sampleShops.every((row) => row.status === 'ACTIVE' && row.onboarding === 'APPROVED'),
    ).toBe(true);

    expect(await stage.db.select().from(restaurants).orderBy(restaurants.id)).toEqual(
      before.restaurants,
    );
    expect((await stage.db.select({ id: menuItems.id }).from(menuItems)).length).toBe(
      before.menuItems,
    );
    expect(await stage.db.select().from(restaurantMembers).orderBy(restaurantMembers.id)).toEqual(
      before.members,
    );
    // What a customer browsing Baghdad sees is unchanged.
    expect(await listing()).toEqual(before.listing);
  });

  it('switches off sign-in for the sample accounts and signs them out', async () => {
    const rows = await stage.db
      .select({ status: users.status, passwordHash: users.passwordHash })
      .from(users)
      .where(inArray(users.id, sampleIds));
    expect(rows.every((row) => row.status === 'DEACTIVATED' && row.passwordHash === null)).toBe(
      true,
    );
    expect(
      await stage.db.select().from(sessions).where(inArray(sessions.userId, sampleIds)),
    ).toEqual([]);

    const refused = await login('demo.market', KNOWN);
    expect(refused.statusCode).toBe(401);
    expect(refused.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('does not touch any other account, the reviewer accounts included', async () => {
    expect(
      await stage.db.select().from(users).where(notInArray(users.id, sampleIds)).orderBy(users.id),
    ).toEqual(before.otherUsers);

    expect((await login(REVIEW_OWNER.username, REVIEW_OWNER.password)).statusCode).toBe(200);
    expect((await login(REVIEW_COURIER.username, REVIEW_COURIER.password)).statusCode).toBe(200);
    expect((await login(REAL_OWNER.username, REAL_OWNER.password)).statusCode).toBe(200);

    const [customer] = await stage.db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, stage.ids.reviewCustomer));
    expect(customer?.status).toBe('ACTIVE');
  });

  it('is applied once, and the file itself is safe to run again', async () => {
    const { runMigrations } = await import('@jibli/db/migrate');
    expect((await runMigrations(stage.url)).applied).toEqual([]);

    const file = readFileSync(join(SOURCE, '0023_disable_sample_shop_logins.sql'), 'utf8');
    await stage.client.begin(async (tx) => {
      await tx.unsafe(file);
    });
    expect(
      await stage.db.select().from(users).where(notInArray(users.id, sampleIds)).orderBy(users.id),
    ).toHaveLength(before.otherUsers.length);
  });
});
