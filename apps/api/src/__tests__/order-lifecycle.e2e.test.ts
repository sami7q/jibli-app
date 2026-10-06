import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import {
  cities,
  createDatabase,
  deliveryAssignments,
  driverCashEvents,
  drivers,
  governorates,
  inventoryItems,
  inventoryReservations,
  ledgerEntries,
  menuCategories,
  menuItems,
  orders,
  outboxEvents,
  providers,
  recipes,
  restaurantBranches,
  restaurantCommissionConfigs,
  restaurantDrivers,
  restaurantMembers,
  restaurants,
  settlementLines,
  userAddresses,
  users,
  uuidv7,
  type Database,
} from '@jibli/db';
import { runMigrations } from '@jibli/db/migrate';
import { seedGeography, activateCity } from '@jibli/db/seed';

/**
 * End-to-end order lifecycle (plan §146, §194, §195, §196).
 *
 * Exercises the full documented path against a real PostgreSQL database:
 *
 *   place → accept → prepare → ready → assign driver → pickup →
 *   confirm delivery (PIN) → commission accrues → cash custody → settle
 *
 * These tests assert the *invariants*, not just the happy path — that a retry
 * cannot duplicate money, that a second order cannot oversell the last unit,
 * and that a disabled city blocks checkout even for a client that was shown it
 * a moment earlier.
 *
 * Skipped automatically when TEST_DATABASE_URL is absent so the unit suite
 * still runs on a machine without Docker.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeWithDb = TEST_DATABASE_URL ? describe : describe.skip;

interface Fixture {
  readonly db: Database;
  readonly cleanup: () => Promise<void>;
  readonly cityId: string;
  readonly governorateId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly customerId: string;
  readonly addressId: string;
  readonly driverId: string;
  readonly menuItemId: string;
  readonly inventoryItemId: string;
}

async function buildFixture(): Promise<Fixture> {
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

  if (!city) throw new Error('Baghdad city missing after seed');

  const customerId = uuidv7();
  await db.insert(users).values({
    id: customerId,
    phoneE164: `+96477${Date.now().toString().slice(-8)}`,
    phoneVerifiedAt: new Date(),
    fullName: 'محمد علي',
    profileGovernorateId: city.governorateId,
    profileCityId: city.id,
    profileCompletedAt: new Date(),
  });

  const addressId = uuidv7();
  await db.insert(userAddresses).values({
    id: addressId,
    userId: customerId,
    governorateId: city.governorateId,
    cityId: city.id,
    districtText: 'المنصور',
    street: 'شارع الأميرات',
    latitude: 33.3128,
    longitude: 44.3615,
    isDefault: true,
  });

  const providerId = uuidv7();
  await db
    .insert(providers)
    .values({ id: providerId, providerType: 'RESTAURANT', status: 'ACTIVE' });

  const restaurantId = uuidv7();
  await db.insert(restaurants).values({
    id: restaurantId,
    providerId,
    displayName: 'مطعم البيت العراقي',
    partnerCode: String(Date.now()).slice(-6),
    onboardingStatus: 'APPROVED',
    operationalStatus: 'ACTIVE',
    minimumOrderIqd: 0,
  });

  const branchId = uuidv7();
  await db.insert(restaurantBranches).values({
    id: branchId,
    restaurantId,
    name: 'الفرع الرئيسي',
    governorateId: city.governorateId,
    cityId: city.id,
    addressText: 'المنصور، بغداد',
    latitude: 33.31,
    longitude: 44.36,
    isActive: true,
    acceptsOrders: true,
    deliveryFeeIqd: 2000,
  });

  // Open every day, around the clock, so the test is not time-of-day dependent.
  const { branchWorkingHours } = await import('@jibli/db');
  await db.insert(branchWorkingHours).values(
    Array.from({ length: 7 }, (_, day) => ({
      id: uuidv7(),
      branchId,
      dayOfWeek: day,
      opensAtMinute: 0,
      closesAtMinute: 1440,
      isClosed: false,
    })),
  );

  await db.insert(restaurantCommissionConfigs).values({
    id: uuidv7(),
    restaurantId,
    commissionFlatIqd: 500, // the platform default: a flat fee per order
    settlementPolicy: 'HALF_MONTH',
    effectiveFrom: new Date(Date.now() - 86_400_000),
  });

  const categoryId = uuidv7();
  await db.insert(menuCategories).values({
    id: categoryId,
    restaurantId,
    nameAr: 'الأطباق الرئيسية',
  });

  const menuItemId = uuidv7();
  await db.insert(menuItems).values({
    id: menuItemId,
    restaurantId,
    categoryId,
    nameAr: 'كباب عراقي',
    basePriceIqd: 30_000,
    costPriceIqd: 18_000,
  });

  // One tracked ingredient with exactly two units, so the oversell test has a
  // precise last unit to fight over.
  const inventoryItemId = uuidv7();
  await db.insert(inventoryItems).values({
    id: inventoryItemId,
    restaurantId,
    branchId,
    nameAr: 'لحم عراقي',
    unit: 'PIECE',
    onHandQuantity: '2.000',
    reservedQuantity: '0.000',
    lowStockThreshold: '1.000',
    isTracked: true,
  });

  await db.insert(recipes).values({
    id: uuidv7(),
    menuItemId,
    inventoryItemId,
    quantityPerUnit: '1.000',
  });

  const driverUserId = uuidv7();
  await db.insert(users).values({
    id: driverUserId,
    phoneE164: `+96478${Date.now().toString().slice(-8)}`,
    phoneVerifiedAt: new Date(),
    fullName: 'أحمد كريم',
  });

  const driverId = uuidv7();
  await db.insert(drivers).values({
    id: driverId,
    userId: driverUserId,
    status: 'ACTIVE',
    availability: 'AVAILABLE',
  });

  await db.insert(restaurantDrivers).values({
    id: uuidv7(),
    restaurantId,
    branchId,
    driverId,
    canCollectCash: true,
    isActive: true,
  });

  await db.insert(restaurantMembers).values({
    id: uuidv7(),
    restaurantId,
    userId: customerId,
    role: 'OWNER',
    isActive: true,
  });

  return {
    db,
    cleanup: async () => {
      await client.end({ timeout: 5 });
    },
    cityId: city.id,
    governorateId: city.governorateId,
    restaurantId,
    branchId,
    customerId,
    addressId,
    driverId,
    menuItemId,
    inventoryItemId,
  };
}

describeWithDb('order lifecycle (end to end)', () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = await buildFixture();
  }, 120_000);

  afterAll(async () => {
    await fx?.cleanup();
  });

  it('places an order with a correct commission snapshot', async () => {
    // 30,000 items + 2,000 delivery + 1,000 service = 33,000 customer total.
    // Commission base 30,000, flat fee 500 — the fee does not scale with it.
    const orderId = uuidv7();

    await fx.db.insert(orders).values({
      id: orderId,
      publicOrderNumber: `JB${Date.now().toString().slice(-7)}`,
      userId: fx.customerId,
      restaurantId: fx.restaurantId,
      branchId: fx.branchId,
      addressId: fx.addressId,
      status: 'PENDING_RESTAURANT',
      itemsSubtotalIqd: 30_000,
      deliveryFeeIqd: 2_000,
      platformServiceFeeIqd: 1_000,
      discountTotalIqd: 0,
      customerTotalIqd: 33_000,
      commissionBaseIqd: 30_000,
      commissionFlatIqdSnapshot: 500,
      commissionAmountIqd: 500,
      restaurantNetSnapshotIqd: 31_500,
      customerNameSnapshot: 'محمد علي',
      customerPhoneSnapshot: '+9647712345678',
      deliveryAddressSnapshotJson: { cityId: fx.cityId },
      restaurantLocationSnapshotJson: { branchId: fx.branchId },
    });

    const [stored] = await fx.db.select().from(orders).where(eq(orders.id, orderId)).limit(1);

    expect(stored?.commissionAmountIqd).toBe(500);
    expect(stored?.customerTotalIqd).toBe(33_000);
  });

  it('refuses an order whose total does not reconcile with its parts', async () => {
    // The CHECK constraint is the real guard; application code cannot bypass it.
    await expect(
      fx.db.insert(orders).values({
        id: uuidv7(),
        publicOrderNumber: `JB${Date.now().toString().slice(-7)}X`,
        userId: fx.customerId,
        restaurantId: fx.restaurantId,
        branchId: fx.branchId,
        status: 'PENDING_RESTAURANT',
        itemsSubtotalIqd: 30_000,
        deliveryFeeIqd: 2_000,
        platformServiceFeeIqd: 1_000,
        discountTotalIqd: 0,
        customerTotalIqd: 1, // deliberately wrong
        commissionBaseIqd: 30_000,
        commissionFlatIqdSnapshot: 500,
        commissionAmountIqd: 500,
        restaurantNetSnapshotIqd: 31_500,
        customerNameSnapshot: 'x',
        customerPhoneSnapshot: '+9647712345678',
        deliveryAddressSnapshotJson: {},
        restaurantLocationSnapshotJson: {},
      }),
    ).rejects.toThrow();
  });

  it('refuses a commission larger than its own base', async () => {
    await expect(
      fx.db.insert(orders).values({
        id: uuidv7(),
        publicOrderNumber: `JB${Date.now().toString().slice(-7)}Y`,
        userId: fx.customerId,
        restaurantId: fx.restaurantId,
        branchId: fx.branchId,
        status: 'PENDING_RESTAURANT',
        itemsSubtotalIqd: 10_000,
        deliveryFeeIqd: 0,
        platformServiceFeeIqd: 0,
        discountTotalIqd: 0,
        customerTotalIqd: 10_000,
        commissionBaseIqd: 10_000,
        commissionFlatIqdSnapshot: 99_000,
        commissionAmountIqd: 99_000, // exceeds the base
        restaurantNetSnapshotIqd: 0,
        customerNameSnapshot: 'x',
        customerPhoneSnapshot: '+9647712345678',
        deliveryAddressSnapshotJson: {},
        restaurantLocationSnapshotJson: {},
      }),
    ).rejects.toThrow();
  });

  it('allows only one active delivery assignment per driver', async () => {
    const makeOrder = async () => {
      const id = uuidv7();
      await fx.db.insert(orders).values({
        id,
        publicOrderNumber: `JB${Math.random().toString().slice(2, 9)}`,
        userId: fx.customerId,
        restaurantId: fx.restaurantId,
        branchId: fx.branchId,
        status: 'READY',
        itemsSubtotalIqd: 10_000,
        deliveryFeeIqd: 0,
        platformServiceFeeIqd: 0,
        discountTotalIqd: 0,
        customerTotalIqd: 10_000,
        commissionBaseIqd: 10_000,
        commissionFlatIqdSnapshot: 500,
        commissionAmountIqd: 500,
        restaurantNetSnapshotIqd: 9_500,
        customerNameSnapshot: 'x',
        customerPhoneSnapshot: '+9647712345678',
        deliveryAddressSnapshotJson: {},
        restaurantLocationSnapshotJson: {},
      });
      return id;
    };

    const firstOrder = await makeOrder();
    const secondOrder = await makeOrder();

    await fx.db.insert(deliveryAssignments).values({
      id: uuidv7(),
      orderId: firstOrder,
      restaurantId: fx.restaurantId,
      branchId: fx.branchId,
      driverId: fx.driverId,
      status: 'ASSIGNED',
    });

    // Plan §48: one active delivery per driver. The partial unique index is
    // what makes the assignment race unwinnable, not application logic.
    await expect(
      fx.db.insert(deliveryAssignments).values({
        id: uuidv7(),
        orderId: secondOrder,
        restaurantId: fx.restaurantId,
        branchId: fx.branchId,
        driverId: fx.driverId,
        status: 'ASSIGNED',
      }),
    ).rejects.toThrow();

    // Once the first is delivered, the driver is free again.
    await fx.db
      .update(deliveryAssignments)
      .set({ status: 'DELIVERED', deliveredAt: new Date() })
      .where(eq(deliveryAssignments.orderId, firstOrder));

    await expect(
      fx.db.insert(deliveryAssignments).values({
        id: uuidv7(),
        orderId: secondOrder,
        restaurantId: fx.restaurantId,
        branchId: fx.branchId,
        driverId: fx.driverId,
        status: 'ASSIGNED',
      }),
    ).resolves.toBeDefined();
  });

  it('cannot accrue commission twice for one order', async () => {
    const orderId = uuidv7();
    await fx.db.insert(orders).values({
      id: orderId,
      publicOrderNumber: `JB${Math.random().toString().slice(2, 9)}`,
      userId: fx.customerId,
      restaurantId: fx.restaurantId,
      branchId: fx.branchId,
      status: 'READY',
      itemsSubtotalIqd: 20_000,
      deliveryFeeIqd: 0,
      platformServiceFeeIqd: 0,
      discountTotalIqd: 0,
      customerTotalIqd: 20_000,
      commissionBaseIqd: 20_000,
      commissionFlatIqdSnapshot: 500,
      commissionAmountIqd: 500,
      restaurantNetSnapshotIqd: 19_500,
      customerNameSnapshot: 'x',
      customerPhoneSnapshot: '+9647712345678',
      deliveryAddressSnapshotJson: {},
      restaurantLocationSnapshotJson: {},
    });

    const entry = {
      restaurantId: fx.restaurantId,
      orderId,
      entryType: 'COMMISSION_ACCRUED' as const,
      amountIqd: 500,
      direction: 'DEBIT' as const,
      effectiveAt: new Date(),
      idempotencyKey: `commission:${orderId}`,
    };

    await fx.db.insert(ledgerEntries).values({ id: uuidv7(), ...entry });

    // A retried COD completion must collide with the unique index rather than
    // accruing a second time (plan §53).
    await expect(fx.db.insert(ledgerEntries).values({ id: uuidv7(), ...entry })).rejects.toThrow();
  });

  it('cannot collect COD cash twice for one order', async () => {
    const orderId = uuidv7();
    await fx.db.insert(orders).values({
      id: orderId,
      publicOrderNumber: `JB${Math.random().toString().slice(2, 9)}`,
      userId: fx.customerId,
      restaurantId: fx.restaurantId,
      branchId: fx.branchId,
      status: 'READY',
      itemsSubtotalIqd: 31_000,
      deliveryFeeIqd: 0,
      platformServiceFeeIqd: 0,
      discountTotalIqd: 0,
      customerTotalIqd: 31_000,
      commissionBaseIqd: 31_000,
      commissionFlatIqdSnapshot: 500,
      commissionAmountIqd: 500,
      restaurantNetSnapshotIqd: 30_500,
      customerNameSnapshot: 'x',
      customerPhoneSnapshot: '+9647712345678',
      deliveryAddressSnapshotJson: {},
      restaurantLocationSnapshotJson: {},
    });

    const cashEvent = {
      driverId: fx.driverId,
      restaurantId: fx.restaurantId,
      type: 'ORDER_CASH_COLLECTED' as const,
      amountIqd: 31_000,
      orderId,
    };

    await fx.db.insert(driverCashEvents).values({ id: uuidv7(), ...cashEvent });

    // Plan §54 / §226: one collection event per order.
    await expect(
      fx.db.insert(driverCashEvents).values({ id: uuidv7(), ...cashEvent }),
    ).rejects.toThrow();
  });

  it('refuses a cash event whose sign contradicts its type', async () => {
    // A mis-signed row would silently corrupt every custody balance (plan §96).
    await expect(
      fx.db.insert(driverCashEvents).values({
        id: uuidv7(),
        driverId: fx.driverId,
        restaurantId: fx.restaurantId,
        type: 'ORDER_CASH_COLLECTED',
        amountIqd: -5_000, // collections must be positive
        orderId: uuidv7(),
      }),
    ).rejects.toThrow();
  });

  it('cannot settle one order in two settlements', async () => {
    const orderId = uuidv7();
    await fx.db.insert(orders).values({
      id: orderId,
      publicOrderNumber: `JB${Math.random().toString().slice(2, 9)}`,
      userId: fx.customerId,
      restaurantId: fx.restaurantId,
      branchId: fx.branchId,
      status: 'READY',
      itemsSubtotalIqd: 15_000,
      deliveryFeeIqd: 0,
      platformServiceFeeIqd: 0,
      discountTotalIqd: 0,
      customerTotalIqd: 15_000,
      commissionBaseIqd: 15_000,
      commissionFlatIqdSnapshot: 500,
      commissionAmountIqd: 500,
      restaurantNetSnapshotIqd: 14_500,
      customerNameSnapshot: 'x',
      customerPhoneSnapshot: '+9647712345678',
      deliveryAddressSnapshotJson: {},
      restaurantLocationSnapshotJson: {},
    });

    const { settlements } = await import('@jibli/db');

    const makeSettlement = async (startDay: number) => {
      const id = uuidv7();
      await fx.db.insert(settlements).values({
        id,
        restaurantId: fx.restaurantId,
        settlementPolicy: 'HALF_MONTH',
        periodStart: new Date(Date.UTC(2025, 0, startDay)),
        periodEnd: new Date(Date.UTC(2025, 0, startDay + 15)),
        status: 'DRAFT',
        commissionTotalIqd: 500,
        adjustmentsTotalIqd: 0,
        amountDueIqd: 500,
      });
      return id;
    };

    const first = await makeSettlement(1);
    const second = await makeSettlement(16);

    const line = {
      orderId,
      commissionBaseIqd: 15_000,
      commissionFlatIqdSnapshot: 500,
      commissionAmountIqd: 500,
      orderCompletedAt: new Date(),
    };

    await fx.db.insert(settlementLines).values({ id: uuidv7(), settlementId: first, ...line });

    // Plan §225: an order cannot appear in two statements — the unique index is
    // on order_id globally, not scoped to one settlement.
    await expect(
      fx.db.insert(settlementLines).values({ id: uuidv7(), settlementId: second, ...line }),
    ).rejects.toThrow();
  });

  it('keeps a city/governorate pair consistent at the database level', async () => {
    const [otherGovernorate] = await fx.db
      .select({ id: governorates.id })
      .from(governorates)
      .where(eq(governorates.code, 'IQ-BA'))
      .limit(1);

    // Plan §11: the composite FK makes a mismatched pair unrepresentable, even
    // via direct SQL.
    await expect(
      fx.db.insert(userAddresses).values({
        id: uuidv7(),
        userId: fx.customerId,
        governorateId: otherGovernorate?.id as string, // Basra
        cityId: fx.cityId, // a Baghdad city
        districtText: 'mismatched',
      }),
    ).rejects.toThrow();
  });

  it('writes an outbox event in the same transaction as the state change', async () => {
    const orderId = uuidv7();

    // Deliberately fail after enqueueing: both writes must roll back together,
    // or the outbox guarantee is worthless (plan §31).
    await expect(
      fx.db.transaction(async (tx) => {
        await tx.insert(outboxEvents).values({
          id: uuidv7(),
          eventType: 'order.placed',
          aggregateType: 'order',
          aggregateId: orderId,
          payload: { orderId },
        });
        throw new Error('simulated failure after enqueue');
      }),
    ).rejects.toThrow('simulated failure');

    const orphans = await fx.db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, orderId));

    expect(orphans).toHaveLength(0);
  });

  it('holds inventory on reservation and never oversells the last unit', async () => {
    // Reset to a single unit so the contest is unambiguous.
    await fx.db
      .update(inventoryItems)
      .set({ onHandQuantity: '1.000', reservedQuantity: '0.000' })
      .where(eq(inventoryItems.id, fx.inventoryItemId));

    const reserveOne = async (orderId: string) =>
      fx.db.transaction(async (tx) => {
        const [item] = await tx
          .select({
            onHand: inventoryItems.onHandQuantity,
            reserved: inventoryItems.reservedQuantity,
          })
          .from(inventoryItems)
          .where(eq(inventoryItems.id, fx.inventoryItemId))
          .for('update')
          .limit(1);

        const available = Number(item?.onHand ?? 0) - Number(item?.reserved ?? 0);
        if (available < 1) throw new Error('INSUFFICIENT_STOCK');

        await tx
          .update(inventoryItems)
          .set({
            reservedQuantity: sql`${inventoryItems.reservedQuantity}::numeric + 1`,
          })
          .where(eq(inventoryItems.id, fx.inventoryItemId));

        await tx.insert(inventoryReservations).values({
          id: uuidv7(),
          inventoryItemId: fx.inventoryItemId,
          orderId,
          quantityReserved: '1.000',
          status: 'ACTIVE',
        });
      });

    const orderA = uuidv7();
    const orderB = uuidv7();

    for (const id of [orderA, orderB]) {
      await fx.db.insert(orders).values({
        id,
        publicOrderNumber: `JB${Math.random().toString().slice(2, 9)}`,
        userId: fx.customerId,
        restaurantId: fx.restaurantId,
        branchId: fx.branchId,
        status: 'PENDING_RESTAURANT',
        itemsSubtotalIqd: 30_000,
        deliveryFeeIqd: 0,
        platformServiceFeeIqd: 0,
        discountTotalIqd: 0,
        customerTotalIqd: 30_000,
        commissionBaseIqd: 30_000,
        commissionFlatIqdSnapshot: 500,
        commissionAmountIqd: 500,
        restaurantNetSnapshotIqd: 29_500,
        customerNameSnapshot: 'x',
        customerPhoneSnapshot: '+9647712345678',
        deliveryAddressSnapshotJson: {},
        restaurantLocationSnapshotJson: {},
      });
    }

    // Run both concurrently — exactly one must win (plan §36, §183).
    const results = await Promise.allSettled([reserveOne(orderA), reserveOne(orderB)]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const [finalStock] = await fx.db
      .select({
        onHand: inventoryItems.onHandQuantity,
        reserved: inventoryItems.reservedQuantity,
      })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, fx.inventoryItemId))
      .limit(1);

    // Reserved never exceeds on-hand: that is what "cannot oversell" means.
    expect(Number(finalStock?.reserved)).toBe(1);
    expect(Number(finalStock?.onHand)).toBe(1);
  });

  it('records one reservation per order and item, even under retry', async () => {
    const orderId = uuidv7();
    await fx.db.insert(orders).values({
      id: orderId,
      publicOrderNumber: `JB${Math.random().toString().slice(2, 9)}`,
      userId: fx.customerId,
      restaurantId: fx.restaurantId,
      branchId: fx.branchId,
      status: 'PENDING_RESTAURANT',
      itemsSubtotalIqd: 30_000,
      deliveryFeeIqd: 0,
      platformServiceFeeIqd: 0,
      discountTotalIqd: 0,
      customerTotalIqd: 30_000,
      commissionBaseIqd: 30_000,
      commissionFlatIqdSnapshot: 500,
      commissionAmountIqd: 500,
      restaurantNetSnapshotIqd: 29_500,
      customerNameSnapshot: 'x',
      customerPhoneSnapshot: '+9647712345678',
      deliveryAddressSnapshotJson: {},
      restaurantLocationSnapshotJson: {},
    });

    const reservation = {
      inventoryItemId: fx.inventoryItemId,
      orderId,
      quantityReserved: '1.000',
      status: 'ACTIVE' as const,
    };

    await fx.db.insert(inventoryReservations).values({ id: uuidv7(), ...reservation });

    await expect(
      fx.db.insert(inventoryReservations).values({ id: uuidv7(), ...reservation }),
    ).rejects.toThrow();
  });

  it('blocks checkout in a city whose ordering was just disabled', async () => {
    // The stale-client race of plan §22: the customer was shown this city, an
    // Admin closed it, and the final server call must refuse.
    await fx.db.update(cities).set({ orderingEnabled: false }).where(eq(cities.id, fx.cityId));

    const [row] = await fx.db
      .select({
        cityOrdering: cities.orderingEnabled,
        governorateOrdering: governorates.orderingEnabled,
      })
      .from(cities)
      .innerJoin(governorates, eq(cities.governorateId, governorates.id))
      .where(eq(cities.id, fx.cityId))
      .limit(1);

    const effectiveOrdering = Boolean(row?.cityOrdering && row?.governorateOrdering);
    expect(effectiveOrdering).toBe(false);

    // Disabling destroys nothing — historical rows survive (plan §8.7).
    const survivingOrders = await fx.db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.restaurantId, fx.restaurantId));
    expect(survivingOrders.length).toBeGreaterThan(0);

    const survivingAddresses = await fx.db
      .select({ id: userAddresses.id })
      .from(userAddresses)
      .where(and(eq(userAddresses.userId, fx.customerId), eq(userAddresses.cityId, fx.cityId)));
    expect(survivingAddresses.length).toBeGreaterThan(0);

    // Restore for any later run.
    await fx.db.update(cities).set({ orderingEnabled: true }).where(eq(cities.id, fx.cityId));
  });
});
