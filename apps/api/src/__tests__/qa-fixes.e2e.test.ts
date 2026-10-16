import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { loadApiEnv } from '@jibli/config';
import { createLogger } from '@jibli/logger';
import {
  cities,
  createDatabase,
  deliveryAssignments,
  deliveryPinAttempts,
  drivers,
  orders,
  providers,
  restaurantBranches,
  restaurantDrivers,
  restaurantMembers,
  restaurants,
  userPlatformRoles,
  users,
  uuidv7,
  type Database,
} from '@jibli/db';
import { runMigrations } from '@jibli/db/migrate';
import { activateCity, seedGeography } from '@jibli/db/seed';
import { ConsolePushProvider, ConsoleSmsProvider } from '@jibli/notifications';
import { generateTotpCode, type Principal } from '@jibli/auth';
import { hashDeliveryPin } from '@jibli/domain';
import type { OrderStatus, PlatformRole } from '@jibli/contracts';
import { createRedis, type AppContext } from '../lib/context.js';
import { buildServer, type BuiltServer } from '../server.js';
import { issueSession } from '../services/session-service.js';
import { confirmDelivery } from '../services/delivery-service.js';
import { startRedisStub, type RedisStub } from '../testing/redis-stub.js';

/**
 * The server half of the pre-launch QA fixes: the delivery PIN the customer can
 * now read (CUST-1), the attempt limit that now counts down (FLOW-2), the
 * courier-credential takeover guard (FLOW-3), the admin-notification and
 * portal-user guards (ADMIN-5/6), step-up and must-change-password (ADMIN-1/7/
 * 10), the unique-violation translation (MERCH-5/FLOW-6) and the order-history
 * 500 (MERCH-15).
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDb = TEST_DATABASE_URL ? describe : describe.skip;

const PEPPER = 'c'.repeat(44);

/** The test database persists between runs, so usernames must be unique each run. */
const RUN = Math.random().toString(36).slice(2, 8);

interface Flow {
  readonly server: BuiltServer;
  readonly ctx: AppContext;
  readonly db: Database;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly cityId: string;
  readonly governorateId: string;
  readonly ownerUserId: string;
  readonly customerId: string;
  readonly driverId: string;
  readonly driverUserId: string;
  readonly superAdminSecret: string;
  readonly ids: {
    superAdmin: string;
    onboarding: string;
    ops: string;
    analystStaff: string;
  };
  readonly token: (userId: string) => Promise<string>;
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
    OTP_HASH_PEPPER: PEPPER,
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

  const person = async (
    name: string,
    opts: {
      roles?: PlatformRole[];
      username?: string;
      mustChangePassword?: boolean;
      profileCompleted?: boolean;
    } = {},
  ): Promise<string> => {
    const id = uuidv7();
    await db.insert(users).values({
      id,
      phoneE164: `+9647${Math.floor(100_000_000 + Math.random() * 899_999_999)}`,
      phoneVerifiedAt: new Date(),
      fullName: name,
      username: opts.username ?? null,
      mustChangePassword: opts.mustChangePassword ?? false,
      profileGovernorateId: city.governorateId,
      profileCityId: city.id,
      profileCompletedAt: opts.profileCompleted === false ? null : new Date(),
      status: 'ACTIVE',
    });
    for (const role of opts.roles ?? []) {
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
    displayName: 'مطعم الفحص',
    partnerCode: `Q${String(Date.now()).slice(-6)}`,
    onboardingStatus: 'APPROVED',
    operationalStatus: 'ACTIVE',
    minimumOrderIqd: 0,
  });
  const branchId = uuidv7();
  await db.insert(restaurantBranches).values({
    id: branchId,
    restaurantId,
    name: 'الفرع',
    governorateId: city.governorateId,
    cityId: city.id,
    addressText: 'بغداد',
    isActive: true,
    acceptsOrders: true,
    deliveryFeeIqd: 2000,
  });

  const ownerUserId = await person('صاحب المتجر');
  await db
    .insert(restaurantMembers)
    .values({ id: uuidv7(), restaurantId, userId: ownerUserId, role: 'OWNER', isActive: true });

  const customerId = await person('مصطفى الزبون');

  // A driver whose user is ALSO a self-registered customer (profileCompletedAt).
  const driverUserId = await person('حيدر المندوب', { profileCompleted: true });
  const driverId = uuidv7();
  await db
    .insert(drivers)
    .values({ id: driverId, userId: driverUserId, status: 'ACTIVE', availability: 'AVAILABLE' });
  await db
    .insert(restaurantDrivers)
    .values({ id: uuidv7(), restaurantId, branchId, driverId, isActive: true });

  // A super admin with MFA enrolled (secret stored plaintext — no enc key in the
  // test env, which decryptSecret returns as-is).
  const superAdminSecret = 'JBSWY3DPEHPK3PXP';
  const superAdmin = await person('المدير', {
    roles: ['SUPER_ADMIN'],
    username: `qa.super.${RUN}`,
  });
  await db
    .update(users)
    .set({ mfaSecretEncrypted: superAdminSecret, mfaEnabledAt: new Date() })
    .where(eq(users.id, superAdmin));

  const onboarding = await person('موظف الانضمام', {
    roles: ['RESTAURANT_ONBOARDING'],
    username: `qa.onb.${RUN}`,
  });
  const ops = await person('موظف العمليات', {
    roles: ['OPERATIONS_ADMIN'],
    username: `qa.ops.${RUN}`,
  });
  const analystStaff = await person('محلل البيانات', {
    roles: ['ANALYST'],
    username: `qa.ana.${RUN}`,
  });

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
    ctx,
    db,
    restaurantId,
    branchId,
    cityId: city.id,
    governorateId: city.governorateId,
    ownerUserId,
    customerId,
    driverId,
    driverUserId,
    superAdminSecret,
    ids: { superAdmin, onboarding, ops, analystStaff },
    token,
    teardown: async () => {
      await server.realtime.close();
      await server.app.close();
      ctx.redis.disconnect();
      await redis.close();
      await client.end();
    },
  };
}

describeWithDb('pre-launch QA fixes (server half)', () => {
  let flow: Flow;

  const makeOrder = async (overrides: {
    status: OrderStatus;
    userId?: string;
    pin?: string | null;
    rejectionReason?: string | null;
  }): Promise<string> => {
    const id = uuidv7();
    const pin = overrides.pin === undefined ? '1234' : overrides.pin;
    const now = new Date();
    // A COMPLETED order must be PAID_CASH with delivery timestamps (check
    // constraint orders_completed_requires_delivery).
    const completed = overrides.status === 'COMPLETED';
    await flow.db.insert(orders).values({
      id,
      publicOrderNumber: `QB${Math.random().toString().slice(2, 9)}`,
      userId: overrides.userId ?? flow.customerId,
      restaurantId: flow.restaurantId,
      branchId: flow.branchId,
      status: overrides.status,
      paymentStatus: completed ? 'PAID_CASH' : 'CASH_EXPECTED',
      // Placed an hour ago so delivered/completed timestamps sit after it
      // (check constraint orders_timestamps_ordered).
      placedAt: new Date(now.getTime() - 3_600_000),
      deliveredAt: completed ? now : null,
      completedAt: completed ? now : null,
      itemsSubtotalIqd: 10_000,
      deliveryFeeIqd: 0,
      platformServiceFeeIqd: 0,
      discountTotalIqd: 0,
      customerTotalIqd: 10_000,
      commissionBaseIqd: 10_000,
      commissionFlatIqdSnapshot: 500,
      commissionAmountIqd: 500,
      restaurantNetSnapshotIqd: 9_500,
      customerNameSnapshot: 'مصطفى الزبون',
      customerPhoneSnapshot: '+9647712345678',
      deliveryAddressSnapshotJson: { cityId: flow.cityId },
      restaurantLocationSnapshotJson: { displayName: 'مطعم الفحص', branchId: flow.branchId },
      deliveryPinHash: pin ? hashDeliveryPin(pin, id, PEPPER) : null,
      deliveryPinPlaintext: pin,
      rejectionReason: overrides.rejectionReason ?? null,
    });
    return id;
  };

  // A fresh driver + membership per test that leaves an assignment active, so
  // the one-active-per-driver unique index does not bleed between tests.
  const makeDriver = async (): Promise<{ driverId: string; userId: string }> => {
    const userId = uuidv7();
    await flow.db.insert(users).values({
      id: userId,
      phoneE164: `+9647${Math.floor(100_000_000 + Math.random() * 899_999_999)}`,
      phoneVerifiedAt: new Date(),
      fullName: 'مندوب فحص',
      status: 'ACTIVE',
    });
    const driverId = uuidv7();
    await flow.db
      .insert(drivers)
      .values({ id: driverId, userId, status: 'ACTIVE', availability: 'AVAILABLE' });
    await flow.db.insert(restaurantDrivers).values({
      id: uuidv7(),
      restaurantId: flow.restaurantId,
      branchId: flow.branchId,
      driverId,
      isActive: true,
    });
    return { driverId, userId };
  };

  const driverPrincipal = (driverId: string, userId: string): Principal => ({
    userId,
    sessionId: 'test',
    platformRoles: [],
    restaurantRoles: {},
    driverId,
    profileCompleted: true,
    phoneVerified: true,
    mfaAt: null,
    mfaEnrolled: false,
    mfaRequiredByPolicy: false,
    mustChangePassword: false,
  });

  const call = (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    token: string | null,
    opts: { payload?: Record<string, unknown>; restaurantId?: string } = {},
  ) =>
    flow.server.app.inject({
      method,
      url,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(opts.restaurantId ? { 'x-restaurant-id': opts.restaurantId } : {}),
      },
      ...(opts.payload ? { payload: opts.payload } : {}),
    });

  beforeAll(async () => {
    flow = await setUp();
  }, 120_000);

  afterAll(async () => {
    await flow?.teardown();
  });

  // ── CUST-1 / FLOW-1 ──────────────────────────────────────────────────────
  it('returns the delivery PIN to the order owner only while the order is in flight', async () => {
    const customer = await flow.token(flow.customerId);

    const accepted = await makeOrder({ status: 'ACCEPTED', pin: '1043' });
    const inflight = await call('GET', `/api/v1/orders/${accepted}`, customer);
    expect(inflight.statusCode).toBe(200);
    expect(inflight.json().data.delivery_pin).toBe('1043');

    const completed = await makeOrder({ status: 'COMPLETED', pin: '7777' });
    const done = await call('GET', `/api/v1/orders/${completed}`, customer);
    expect(done.json().data.delivery_pin).toBeNull();

    // Never to another customer.
    const other = await flow.token(flow.ownerUserId);
    const leaked = await call('GET', `/api/v1/orders/${accepted}`, other);
    expect(leaked.statusCode).toBe(404);
  });

  it('returns the Arabic rejection reason on a rejected order (MERCH-20)', async () => {
    const customer = await flow.token(flow.customerId);
    const rejected = await makeOrder({
      status: 'REJECTED',
      pin: null,
      rejectionReason: 'ITEM_UNAVAILABLE',
    });
    const res = await call('GET', `/api/v1/orders/${rejected}`, customer);
    expect(res.json().data.rejection_reason).toBe('ITEM_UNAVAILABLE');
    expect(res.json().data.rejection_reason_ar).toBe('صنف غير متوفر');
  });

  // ── FLOW-2 ───────────────────────────────────────────────────────────────
  it('counts delivery-PIN attempts down and locks, persisting the audit trail', async () => {
    const driver = await makeDriver();
    const orderId = await makeOrder({ status: 'READY', pin: '1234' });
    const assignmentId = uuidv7();
    await flow.db.insert(deliveryAssignments).values({
      id: assignmentId,
      orderId,
      restaurantId: flow.restaurantId,
      branchId: flow.branchId,
      driverId: driver.driverId,
      status: 'PICKED_UP',
    });

    const principal = driverPrincipal(driver.driverId, driver.userId);

    const attemptWrong = () =>
      confirmDelivery(flow.ctx, {
        assignmentId,
        principal,
        deliveryPin: '0000',
        overrideReason: null,
        idempotencyKey: `t-${Math.random()}`,
        requestId: 't',
      });

    const remaining: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      try {
        await attemptWrong();
        throw new Error('wrong PIN should have been refused');
      } catch (error) {
        const details = (error as { details?: { attemptsRemaining?: number } }).details;
        if (details && typeof details.attemptsRemaining === 'number') {
          remaining.push(details.attemptsRemaining);
        }
      }
    }

    // The counter actually counted down (it used to stay at 4 forever).
    expect(remaining[0]).toBe(4);
    expect(remaining[remaining.length - 1]).toBeLessThan(remaining[0] as number);

    // The next attempt is locked out, not just wrong.
    await expect(attemptWrong()).rejects.toMatchObject({ code: 'DELIVERY_PIN_ATTEMPTS_EXCEEDED' });

    // The audit rows persisted (they were rolled back before the fix).
    const rows = await flow.db
      .select({ id: deliveryPinAttempts.id })
      .from(deliveryPinAttempts)
      .where(eq(deliveryPinAttempts.orderId, orderId));
    expect(rows.length).toBeGreaterThanOrEqual(5);

    const [order] = await flow.db
      .select({ attempts: orders.deliveryPinAttempts })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    expect(order?.attempts).toBeGreaterThanOrEqual(5);
  });

  it('refuses to confirm a delivery for a cancelled order (FLOW-8)', async () => {
    const driver = await makeDriver();
    const orderId = await makeOrder({ status: 'CANCELLED', pin: '1234' });
    const assignmentId = uuidv7();
    await flow.db.insert(deliveryAssignments).values({
      id: assignmentId,
      orderId,
      restaurantId: flow.restaurantId,
      branchId: flow.branchId,
      driverId: driver.driverId,
      status: 'PICKED_UP',
    });
    const principal = driverPrincipal(driver.driverId, driver.userId);
    await expect(
      confirmDelivery(flow.ctx, {
        assignmentId,
        principal,
        deliveryPin: '1234',
        overrideReason: null,
        idempotencyKey: `t-${Math.random()}`,
        requestId: 't',
      }),
    ).rejects.toMatchObject({ code: 'DELIVERY_CANNOT_TRANSITION' });
  });

  // ── FLOW-3 ───────────────────────────────────────────────────────────────
  it('refuses to put a password on a self-registered customer account (FLOW-3)', async () => {
    const owner = await flow.token(flow.ownerUserId);
    const res = await call(
      'POST',
      `/api/v1/restaurant-portal/drivers/${flow.driverId}/credentials`,
      owner,
      { payload: { username: 'qa.driver.login' }, restaurantId: flow.restaurantId },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details).toMatchObject({
      reason: 'CUSTOMER_ACCOUNT_CANNOT_BE_TAKEN_OVER',
    });
  });

  // ── MERCH-5 / FLOW-6 ──────────────────────────────────────────────────────
  it('maps a busy-courier assignment to 409 DRIVER_AT_CAPACITY, not 500', async () => {
    const owner = await flow.token(flow.ownerUserId);
    const driver = await makeDriver();
    // The driver already has a live task.
    const firstOrder = await makeOrder({ status: 'READY', pin: null });
    await flow.db.insert(deliveryAssignments).values({
      id: uuidv7(),
      orderId: firstOrder,
      restaurantId: flow.restaurantId,
      branchId: flow.branchId,
      driverId: driver.driverId,
      status: 'ASSIGNED',
    });

    const secondOrder = await makeOrder({ status: 'READY', pin: null });
    const res = await call(
      'POST',
      `/api/v1/restaurant-portal/orders/${secondOrder}/assign-driver`,
      owner,
      { payload: { driver_id: driver.driverId }, restaurantId: flow.restaurantId },
    );
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('DRIVER_AT_CAPACITY');
  });

  it('maps a duplicate staff role to a clean 409, not 500', async () => {
    const owner = await flow.token(flow.ownerUserId);
    const phone = `+9647${Math.floor(500_000_000 + Math.random() * 400_000_000)}`;
    const body = { full_name: 'كاشير فحص', phone, role: 'CASHIER' };
    const first = await call('POST', '/api/v1/restaurant-portal/staff', owner, {
      payload: body,
      restaurantId: flow.restaurantId,
    });
    expect(first.statusCode).toBe(201);
    const second = await call('POST', '/api/v1/restaurant-portal/staff', owner, {
      payload: body,
      restaurantId: flow.restaurantId,
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.details).toMatchObject({ reason: 'STAFF_ALREADY_HAS_ROLE' });
  });

  // ── MERCH-15 ──────────────────────────────────────────────────────────────
  it('serves order history without the ambiguous-id 500 (MERCH-15)', async () => {
    const owner = await flow.token(flow.ownerUserId);
    const res = await call('GET', '/api/v1/restaurant-portal/orders/history', owner, {
      restaurantId: flow.restaurantId,
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().data)).toBe(true);
  });

  // ── ADMIN-5 ──────────────────────────────────────────────────────────────
  it('refuses a plain customer the admin notification feed (ADMIN-5)', async () => {
    const customer = await flow.token(flow.customerId);
    expect((await call('GET', '/api/v1/admin/notifications?limit=5', customer)).statusCode).toBe(
      403,
    );
    expect(
      (await call('GET', '/api/v1/admin/notifications/unread-count', customer)).statusCode,
    ).toBe(403);
  });

  // ── ADMIN-6 ──────────────────────────────────────────────────────────────
  it('refuses onboarding/ops acting on a platform-staff account (ADMIN-6)', async () => {
    const onboarding = await flow.token(flow.ids.onboarding);
    const reset = await call(
      'POST',
      `/api/v1/admin/portal-users/${flow.ids.analystStaff}/reset-password`,
      onboarding,
      { payload: { reason: 'routine rotation' } },
    );
    expect(reset.statusCode).toBe(403);

    const ops = await flow.token(flow.ids.ops);
    const suspend = await call('PATCH', `/api/v1/admin/portal-users/${flow.ids.superAdmin}`, ops, {
      payload: { is_active: false, reason: 'testing the guard' },
    });
    expect(suspend.statusCode).toBe(403);
  });

  // ── ADMIN-7 (reads) and ADMIN-1 (step-up) ─────────────────────────────────
  it('loads staff and roles without a step-up, and step-up unlocks staff creation (ADMIN-1/7)', async () => {
    const superAdmin = await flow.token(flow.ids.superAdmin);

    // Reads load with no fresh MFA.
    expect((await call('GET', '/api/v1/admin/staff', superAdmin)).statusCode).toBe(200);
    expect((await call('GET', '/api/v1/admin/roles', superAdmin)).statusCode).toBe(200);

    // A step-up action is refused before the challenge.
    const before = await call('POST', '/api/v1/admin/staff', superAdmin, {
      payload: { username: `qa.new.staff.${RUN}`, full_name: 'موظف جديد', role: 'SUPPORT_AGENT' },
    });
    expect(before.statusCode).toBe(401);
    expect(before.json().error.code).toBe('REAUTHENTICATION_REQUIRED');

    // Verify MFA on this session.
    const verify = await call('POST', '/api/v1/auth/mfa/verify', superAdmin, {
      payload: { code: generateTotpCode(flow.superAdminSecret) },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().data.access_token).toBeTruthy();

    // The SAME token now passes step-up, via the session mfa_verified_at fallback.
    const after = await call('POST', '/api/v1/admin/staff', superAdmin, {
      payload: { username: `qa.new.staff.${RUN}`, full_name: 'موظف جديد', role: 'SUPPORT_AGENT' },
    });
    expect(after.statusCode).toBe(201);
    expect(after.json().data.password).toBeTruthy();
    expect(after.json().data.must_change_password).toBe(true);
  });

  // ── ADMIN-10 ──────────────────────────────────────────────────────────────
  it('blocks a must-change-password session from everything but the change itself (ADMIN-10)', async () => {
    const stuckId = uuidv7();
    await flow.db.insert(users).values({
      id: stuckId,
      username: `qa.stuck.${RUN}`,
      fullName: 'موظف مؤقت',
      mustChangePassword: true,
      passwordHash: 'x',
      status: 'ACTIVE',
    });
    await flow.db
      .insert(userPlatformRoles)
      .values({ id: uuidv7(), userId: stuckId, role: 'SUPPORT_AGENT' });
    const stuck = await flow.token(stuckId);

    const blocked = await call('GET', '/api/v1/admin/orders', stuck);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    // /auth/me still answers, so the client can route to the change screen.
    expect((await call('GET', '/api/v1/auth/me', stuck)).statusCode).toBe(200);
  });

  // ── FLOW-7 ───────────────────────────────────────────────────────────────
  it('sets a courier offline on sign-out (FLOW-7)', async () => {
    const driverToken = await flow.token(flow.driverUserId);
    await flow.db
      .update(drivers)
      .set({ availability: 'AVAILABLE' })
      .where(eq(drivers.id, flow.driverId));

    const res = await call('POST', '/api/v1/auth/logout', driverToken);
    expect(res.statusCode).toBe(200);

    const [driver] = await flow.db
      .select({ availability: drivers.availability })
      .from(drivers)
      .where(eq(drivers.id, flow.driverId))
      .limit(1);
    expect(driver?.availability).toBe('OFFLINE');
  });
});
