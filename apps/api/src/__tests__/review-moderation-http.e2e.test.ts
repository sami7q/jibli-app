import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { loadApiEnv } from '@jibli/config';
import { createLogger } from '@jibli/logger';
import {
  adminNotifications,
  cities,
  createDatabase,
  orders,
  providers,
  restaurantBranches,
  restaurantMembers,
  restaurants,
  sessions,
  userPlatformRoles,
  users,
  uuidv7,
  type Database,
} from '@jibli/db';
import { runMigrations } from '@jibli/db/migrate';
import { activateCity, seedGeography } from '@jibli/db/seed';
import { ConsolePushProvider, ConsoleSmsProvider } from '@jibli/notifications';
import type { PlatformRole } from '@jibli/contracts';
import { createRedis, type AppContext } from '../lib/context.js';
import { buildServer, type BuiltServer } from '../server.js';
import { issueSession } from '../services/session-service.js';
import { startRedisStub, type RedisStub } from '../testing/redis-stub.js';

/**
 * The whole review flow over HTTP, as the app, the shop portal and Admin call
 * it: the customer agrees to the rules and posts, the screen holds a comment
 * with a phone number, the shop reports and blocks, a role that only reads
 * restaurants is refused the decision, Operations decides, and the customer
 * deletes the account and takes everything they wrote with them.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDb = TEST_DATABASE_URL ? describe : describe.skip;

const DAY = 86_400_000;

interface Flow {
  readonly server: BuiltServer;
  readonly db: Database;
  readonly restaurantId: string;
  readonly orderA: string;
  readonly orderB: string;
  readonly customerId: string;
  readonly tokens: { customer: string; owner: string; ops: string; analyst: string };
  readonly teardown: () => Promise<void>;
}

async function setUp(): Promise<Flow> {
  const redis: RedisStub = await startRedisStub();
  const env = loadApiEnv({
    NODE_ENV: 'test',
    APP_ENV: 'staging',
    DATABASE_URL: TEST_DATABASE_URL as string,
    REDIS_URL: redis.url,
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    OTP_HASH_PEPPER: 'c'.repeat(44),
  });
  const logger = createLogger({ serviceName: 'api-test', environment: 'staging', level: 'silent' });
  const { db, sql: client } = createDatabase({
    connectionString: TEST_DATABASE_URL as string,
    maxConnections: 5,
  });

  await runMigrations(TEST_DATABASE_URL as string);
  await seedGeography(db);
  await activateCity(db, 'IQ-BG-BAGHDAD', {
    customerSignup: true,
    restaurantOnboarding: true,
    ordering: true,
  });
  const [city] = await db
    .select({ id: cities.id, governorateId: cities.governorateId })
    .from(cities)
    .where(eq(cities.code, 'IQ-BG-BAGHDAD'))
    .limit(1);
  if (!city) throw new Error('Baghdad missing');

  const person = async (name: string, roles: PlatformRole[] = []): Promise<string> => {
    const id = uuidv7();
    await db.insert(users).values({
      id,
      phoneE164: `+9647${Math.floor(100_000_000 + Math.random() * 899_999_999)}`,
      phoneVerifiedAt: new Date(),
      fullName: name,
      profileGovernorateId: city.governorateId,
      profileCityId: city.id,
      profileCompletedAt: new Date(),
      status: 'ACTIVE',
    });
    for (const role of roles) {
      await db.insert(userPlatformRoles).values({ id: uuidv7(), userId: id, role });
    }
    return id;
  };

  const providerId = uuidv7();
  await db
    .insert(providers)
    .values({ id: providerId, providerType: 'RESTAURANT', status: 'ACTIVE' });
  const restaurantId = uuidv7();
  await db.insert(restaurants).values({
    id: restaurantId,
    providerId,
    displayName: 'مطعم التدفق',
    partnerCode: `F${String(Date.now()).slice(-6)}`,
    onboardingStatus: 'APPROVED',
    operationalStatus: 'ACTIVE',
  });
  const branchId = uuidv7();
  await db.insert(restaurantBranches).values({
    id: branchId,
    restaurantId,
    name: 'الفرع',
    governorateId: city.governorateId,
    cityId: city.id,
    addressText: 'بغداد',
  });

  const customer = await person('زينب علي');
  const owner = await person('صاحب المتجر');
  await db
    .insert(restaurantMembers)
    .values({ id: uuidv7(), restaurantId, userId: owner, role: 'OWNER' });
  const ops = await person('موظف العمليات', ['OPERATIONS_ADMIN']);
  const analyst = await person('محلل', ['ANALYST']);

  // Completed a day ago: past the rating delay, inside the window.
  const completedOrder = async (): Promise<string> => {
    const id = uuidv7();
    const at = new Date(Date.now() - DAY);
    await db.insert(orders).values({
      id,
      publicOrderNumber: `JF${Math.random().toString().slice(2, 9)}`,
      userId: customer,
      restaurantId,
      branchId,
      status: 'COMPLETED',
      paymentStatus: 'PAID_CASH',
      placedAt: new Date(at.getTime() - 3_600_000),
      deliveredAt: at,
      completedAt: at,
      itemsSubtotalIqd: 10_000,
      deliveryFeeIqd: 0,
      platformServiceFeeIqd: 0,
      discountTotalIqd: 0,
      customerTotalIqd: 10_000,
      commissionBaseIqd: 10_000,
      commissionFlatIqdSnapshot: 500,
      commissionAmountIqd: 500,
      restaurantNetSnapshotIqd: 9_500,
      customerNameSnapshot: 'زينب علي',
      customerPhoneSnapshot: '+9647700000002',
      deliveryAddressSnapshotJson: { cityId: city.id },
      restaurantLocationSnapshotJson: { branchId },
    });
    return id;
  };
  const orderA = await completedOrder();
  const orderB = await completedOrder();

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

  const token = async (userId: string) =>
    (await issueSession(ctx, { userId, userAgent: null, ip: null })).accessToken;

  return {
    server,
    db,
    restaurantId,
    orderA,
    orderB,
    customerId: customer,
    tokens: {
      customer: await token(customer),
      owner: await token(owner),
      ops: await token(ops),
      analyst: await token(analyst),
    },
    teardown: async () => {
      await server.realtime.close();
      await server.app.close();
      ctx.redis.disconnect();
      await redis.close();
      await client.end();
    },
  };
}

describeWithDb('review moderation over HTTP (app → API → portal → Admin)', () => {
  let flow: Flow;
  let reviewA = '';
  let reviewB = '';

  const call = (
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    as: keyof Flow['tokens'] | null,
    payload?: Record<string, unknown>,
  ) =>
    flow.server.app.inject({
      method,
      url,
      headers: {
        ...(as ? { authorization: `Bearer ${flow.tokens[as]}` } : {}),
        ...(as === 'owner' ? { 'x-restaurant-id': flow.restaurantId } : {}),
      },
      ...(payload ? { payload } : {}),
    });

  const publicReviews = async () =>
    (await call('GET', `/api/v1/restaurants/${flow.restaurantId}/reviews`, null)).json().data as {
      rating: number | null;
      rating_count: number;
      reviews: { id: string; comment: string | null; author_name: string }[];
    };

  beforeAll(async () => {
    flow = await setUp();
  }, 120_000);

  afterAll(async () => {
    await flow?.teardown();
  });

  it('refuses a comment until the customer accepts the content rules', async () => {
    const refused = await call('POST', `/api/v1/orders/${flow.orderA}/review`, 'customer', {
      rating: 2,
      comment: 'الأكل وصل بارداً والتوصيل تأخر ساعة',
    });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().error.details).toMatchObject({ reason: 'TERMS_REQUIRED' });

    const posted = await call('POST', `/api/v1/orders/${flow.orderA}/review`, 'customer', {
      rating: 2,
      comment: 'الأكل وصل بارداً والتوصيل تأخر ساعة',
      accepted_terms: true,
    });
    expect(posted.statusCode).toBe(201);
    expect(posted.json().data.held).toBe(false);

    const shown = await publicReviews();
    expect(shown.rating_count).toBe(1);
    reviewA = shown.reviews[0]!.id;
    // First name only, in public.
    expect(shown.reviews[0]!.author_name).toBe('زينب');
  });

  it('holds a comment carrying a phone number, unseen and uncounted', async () => {
    const posted = await call('POST', `/api/v1/orders/${flow.orderB}/review`, 'customer', {
      rating: 1,
      comment: 'اتصلوا بي على 07701234567',
      accepted_terms: true,
    });
    expect(posted.statusCode).toBe(201);
    expect(posted.json().data.held).toBe(true);

    const shown = await publicReviews();
    expect(shown.rating_count).toBe(1);
    expect(shown.reviews.map((review) => review.id)).toEqual([reviewA]);
  });

  it("the shop's report reaches the queue without hiding the review", async () => {
    const reported = await call('POST', `/api/v1/reviews/${reviewA}/report`, 'owner', {
      reason: 'FALSE',
      note: 'الطلب سُلّم في الوقت',
    });
    expect(reported.statusCode).toBe(200);
    expect(reported.json().data).toMatchObject({ reported: true, hidden: false });

    expect((await publicReviews()).reviews.map((review) => review.id)).toContain(reviewA);
  });

  it("blocking the author empties the blocker's list and nobody else's", async () => {
    const before = await call('GET', '/api/v1/restaurant-portal/reviews', 'owner');
    expect(JSON.stringify(before.json().data)).toContain(reviewA);

    const blocked = await call('POST', `/api/v1/reviews/${reviewA}/block-author`, 'owner');
    expect(blocked.statusCode).toBe(200);

    const after = await call('GET', '/api/v1/restaurant-portal/reviews', 'owner');
    expect(JSON.stringify(after.json().data)).not.toContain(reviewA);
    expect((await publicReviews()).reviews.map((review) => review.id)).toContain(reviewA);
  });

  it('a role that only reads restaurants sees the queue but cannot decide', async () => {
    const queue = await call('GET', '/api/v1/admin/review-queue', 'analyst');
    expect(queue.statusCode).toBe(200);
    const items = queue.json().data as { review_id: string; held_reason: string | null }[];
    reviewB = items.find((item) => item.held_reason === 'CONTACT')!.review_id;
    expect(items.map((item) => item.review_id)).toContain(reviewA);

    const resolve = await call('POST', `/api/v1/admin/review-queue/${reviewB}/resolve`, 'analyst', {
      action: 'PUBLISH',
      reason: 'محاولة من دور لا يملك الصلاحية',
    });
    expect(resolve.statusCode).toBe(403);
    expect(resolve.json().error.details).toMatchObject({ requiredPermission: 'review.moderate' });

    const visibility = await call(
      'POST',
      `/api/v1/admin/reviews/${reviewA}/visibility`,
      'analyst',
      {
        hidden: true,
        reason: 'محاولة من دور لا يملك الصلاحية',
      },
    );
    expect(visibility.statusCode).toBe(403);
    expect((await publicReviews()).reviews.map((review) => review.id)).toContain(reviewA);
  });

  it('Operations publishes the held comment and it counts', async () => {
    const resolve = await call('POST', `/api/v1/admin/review-queue/${reviewB}/resolve`, 'ops', {
      action: 'PUBLISH',
      reason: 'رقم المطعم نفسه وليس رقماً شخصياً',
    });
    expect(resolve.statusCode).toBe(200);

    const shown = await publicReviews();
    expect(shown.rating_count).toBe(2);
    expect(shown.reviews.map((review) => review.id).sort()).toEqual([reviewA, reviewB].sort());

    const queue = (await call('GET', '/api/v1/admin/review-queue', 'ops')).json().data as {
      review_id: string;
    }[];
    expect(queue.map((item) => item.review_id)).not.toContain(reviewB);
  });

  it('deleting the account takes every review, report, block and quoted comment with it', async () => {
    const deleted = await call('DELETE', '/api/v1/profile', 'customer');
    expect(deleted.statusCode).toBe(200);

    // Signed out everywhere, and no sign-in IP or user agent left behind.
    expect(
      await flow.db.select().from(sessions).where(eq(sessions.userId, flow.customerId)),
    ).toEqual([]);
    expect((await call('GET', '/api/v1/profile', 'customer')).statusCode).toBe(401);

    const shown = await publicReviews();
    expect(shown.reviews).toEqual([]);
    expect(shown.rating_count).toBe(0);
    expect(shown.rating).toBeNull();

    const queue = (await call('GET', '/api/v1/admin/review-queue', 'ops')).json().data as {
      review_id: string;
    }[];
    expect(queue.map((item) => item.review_id)).not.toContain(reviewA);

    const blocks = (await call('GET', '/api/v1/blocks', 'owner')).json().data as unknown[];
    expect(blocks).toEqual([]);

    const quoting = await flow.db
      .select({ id: adminNotifications.id })
      .from(adminNotifications)
      .where(
        and(
          eq(adminNotifications.entityType, 'order_review'),
          inArray(adminNotifications.entityId, [reviewA, reviewB, flow.orderA, flow.orderB]),
        ),
      );
    expect(quoting).toEqual([]);
  });
});
