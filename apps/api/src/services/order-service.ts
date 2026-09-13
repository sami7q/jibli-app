import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  AppError,
  ERROR_CODES,
  EVENT_TYPES,
  assertTransition,
  ORDER_TRANSITIONS,
  type ActorType,
  type OrderStatus,
} from '@jibli/contracts';
import { hashDeliveryPin } from '@jibli/domain';
import {
  assertOrderable,
  assertAddressServiceable,
  buildQuote,
  assertQuoteUnchanged,
  enqueueOutboxEvent,
  resolveCommissionFee,
  type RequestedLine,
} from '@jibli/domain';
import {
  branchHourExceptions,
  branchWorkingHours,
  cities,
  generateNumericCode,
  generatePublicOrderNumber,
  governorates,
  orderItemModifiers,
  orderItems,
  orders,
  orderStatusHistory,
  restaurantBranches,
  restaurantCommissionConfigs,
  restaurants,
  userAddresses,
  users,
  uuidv7,
  type Transaction,
} from '@jibli/db';
import type { AppContext } from '../lib/context.js';
import { getConfig } from './config-service.js';
import { loadCatalogForPricing } from './quote-service.js';
import { reserveInventoryForOrder } from './inventory-service.js';

/**
 * PlaceOrder (plan §27) — the most critical use case in the platform.
 *
 * The documented sequence, all inside one transaction:
 *   validate customer → profile → geography → restaurant/branch → address →
 *   items/modifiers → recalculate prices → discounts → platform fee →
 *   check inventory → create order → snapshots → reserve inventory →
 *   snapshot commission → status history → outbox event → commit →
 *   publish asynchronously
 *
 * The external notification provider is never called while the transaction is
 * open: the worker picks the outbox row up afterwards.
 */

export interface PlaceOrderInput {
  readonly userId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly addressId: string;
  readonly lines: readonly RequestedLine[];
  readonly customerNotes?: string | null;
  /** What the client displayed; a mismatch raises PRICE_CHANGED (plan §112). */
  readonly expectedTotalIqd?: number | null;
  readonly requestId: string;
}

export interface PlaceOrderResult {
  readonly orderId: string;
  readonly publicOrderNumber: string;
  readonly customerTotalIqd: number;
  readonly status: OrderStatus;
  /** Shown to the customer only; never to the driver or restaurant (plan §52). */
  readonly deliveryPin: string | null;
  readonly estimatedPreparationMinutes: number;
}

export async function placeOrder(
  ctx: AppContext,
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  const globalCheckoutEnabled = await getConfig(ctx, 'global_checkout_enabled', true);
  const platformServiceFeeIqd = await getConfig(ctx, 'platform_service_fee_iqd', 1000);
  const deliveryPinEnabled = await getConfig(ctx, 'delivery_pin_enabled', true);

  const result = await ctx.db.transaction(async (tx) => {
    // 1. Customer, and their profile completeness (plan §11).
    const [customer] = await tx
      .select({
        id: users.id,
        fullName: users.fullName,
        phoneE164: users.phoneE164,
        status: users.status,
        profileCompletedAt: users.profileCompletedAt,
      })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);

    if (!customer) throw new AppError(ERROR_CODES.UNAUTHENTICATED);
    if (customer.status !== 'ACTIVE') throw new AppError(ERROR_CODES.ACCOUNT_SUSPENDED);
    if (!customer.profileCompletedAt) throw new AppError(ERROR_CODES.PROFILE_INCOMPLETE);

    /*
     * A customer always has a phone — they authenticate by OTP, and the driver
     * has to be able to call them. Only staff-created portal accounts lack one
     * and those cannot place orders. Checking rather than asserting means an
     * impossible state fails here, with a clear code, instead of violating the
     * NOT NULL on the order's phone snapshot several statements later.
     */
    if (!customer.phoneE164) {
      throw new AppError(ERROR_CODES.PROFILE_INCOMPLETE, {
        details: { reason: 'NO_PHONE_ON_ACCOUNT' },
      });
    }

    // 2. Delivery address — must belong to this customer.
    const [address] = await tx
      .select()
      .from(userAddresses)
      .where(
        and(
          eq(userAddresses.id, input.addressId),
          eq(userAddresses.userId, input.userId),
          isNull(userAddresses.deletedAt),
        ),
      )
      .limit(1);

    if (!address) {
      throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'address' } });
    }

    // 3. Restaurant and branch, with their geography resolved from the branch row.
    const [branchRow] = await tx
      .select({
        branch: restaurantBranches,
        restaurant: {
          id: restaurants.id,
          displayName: restaurants.displayName,
          onboardingStatus: restaurants.onboardingStatus,
          operationalStatus: restaurants.operationalStatus,
          minimumOrderIqd: restaurants.minimumOrderIqd,
        },
        city: cities,
        governorate: governorates,
      })
      .from(restaurantBranches)
      .innerJoin(restaurants, eq(restaurantBranches.restaurantId, restaurants.id))
      .innerJoin(cities, eq(restaurantBranches.cityId, cities.id))
      .innerJoin(governorates, eq(cities.governorateId, governorates.id))
      .where(
        and(
          eq(restaurantBranches.id, input.branchId),
          eq(restaurantBranches.restaurantId, input.restaurantId),
          isNull(restaurantBranches.deletedAt),
        ),
      )
      .limit(1);

    if (!branchRow) {
      throw new AppError(ERROR_CODES.BRANCH_NOT_AVAILABLE, { details: { branchId: input.branchId } });
    }

    // 4. Eligibility: geography, approval, operational state, hours (plan §125).
    //    This is the check a stale client cannot talk its way past.
    const workingHours = await tx
      .select()
      .from(branchWorkingHours)
      .where(eq(branchWorkingHours.branchId, input.branchId));

    const exceptions = await tx
      .select()
      .from(branchHourExceptions)
      .where(eq(branchHourExceptions.branchId, input.branchId));

    const openState = assertOrderable({
      globalCheckoutEnabled,
      geography: { city: branchRow.city, governorate: branchRow.governorate },
      restaurant: {
        id: branchRow.restaurant.id,
        onboardingStatus: branchRow.restaurant.onboardingStatus,
        operationalStatus: branchRow.restaurant.operationalStatus,
      },
      branch: {
        id: branchRow.branch.id,
        isActive: branchRow.branch.isActive,
        acceptsOrders: branchRow.branch.acceptsOrders,
      },
      hours: {
        rules: workingHours,
        exceptions: exceptions.map((e) => ({
          localDate: e.localDate,
          isClosed: e.isClosed,
          opensAtMinute: e.opensAtMinute,
          closesAtMinute: e.closesAtMinute,
        })),
        busyMode: branchRow.branch.busyMode,
        busyModeExpiresAt: branchRow.branch.busyModeExpiresAt,
        basePreparationMinutes: branchRow.branch.basePreparationMinutes,
      },
    });

    // 5. The delivery address must be inside this branch's service zone (plan §106).
    assertAddressServiceable({
      branch: {
        cityId: branchRow.branch.cityId,
        latitude: branchRow.branch.latitude,
        longitude: branchRow.branch.longitude,
        serviceRadiusMeters: branchRow.branch.serviceRadiusMeters,
      },
      address: {
        cityId: address.cityId,
        latitude: address.latitude,
        longitude: address.longitude,
      },
    });

    // 6–9. Recalculate every price from the catalog; the client's numbers are
    //      only ever used for the "did it change?" comparison.
    const catalog = await loadCatalogForPricing(
      tx,
      input.restaurantId,
      input.lines.map((l) => l.menuItemId),
    );

    const commissionConfigs = await tx
      .select({
        commissionFlatIqd: restaurantCommissionConfigs.commissionFlatIqd,
        effectiveFrom: restaurantCommissionConfigs.effectiveFrom,
        effectiveTo: restaurantCommissionConfigs.effectiveTo,
      })
      .from(restaurantCommissionConfigs)
      .where(eq(restaurantCommissionConfigs.restaurantId, input.restaurantId));

    const commissionFlatIqd = resolveCommissionFee(commissionConfigs, new Date());

    const quote = buildQuote({
      restaurantId: input.restaurantId,
      requestedLines: input.lines,
      catalog,
      deliveryFeeIqd: branchRow.branch.deliveryFeeIqd,
      platformServiceFeeIqd,
      commissionFlatIqd,
      minimumOrderIqd: branchRow.restaurant.minimumOrderIqd,
    });

    assertQuoteUnchanged(input.expectedTotalIqd, quote.totals);

    // 10–14. Create the order with every snapshot it will ever need.
    const orderId = uuidv7();
    const now = new Date();
    const deliveryPin = deliveryPinEnabled ? generateNumericCode(4) : null;

    const addressSnapshot = {
      governorateId: address.governorateId,
      cityId: address.cityId,
      cityNameAr: branchRow.city.nameAr,
      districtText: address.districtText,
      street: address.street,
      building: address.building,
      floor: address.floor,
      landmark: address.landmark,
      latitude: address.latitude,
      longitude: address.longitude,
      deliveryNotes: address.deliveryNotes,
    };

    const restaurantSnapshot = {
      restaurantId: branchRow.restaurant.id,
      displayName: branchRow.restaurant.displayName,
      branchId: branchRow.branch.id,
      branchName: branchRow.branch.name,
      governorateId: branchRow.branch.governorateId,
      cityId: branchRow.branch.cityId,
      cityNameAr: branchRow.city.nameAr,
      addressText: branchRow.branch.addressText,
      latitude: branchRow.branch.latitude,
      longitude: branchRow.branch.longitude,
      phone: branchRow.branch.phone,
    };

    const publicOrderNumber = generatePublicOrderNumber();

    await tx.insert(orders).values({
      id: orderId,
      publicOrderNumber,
      userId: input.userId,
      restaurantId: input.restaurantId,
      branchId: input.branchId,
      addressId: input.addressId,
      // PLACED then immediately queued — the restaurant board reads
      // PENDING_RESTAURANT, and the two-step keeps the history honest.
      status: 'PENDING_RESTAURANT',
      paymentMethod: 'CASH_ON_DELIVERY',
      paymentStatus: 'CASH_EXPECTED',
      currency: 'IQD',

      itemsSubtotalIqd: quote.totals.itemsSubtotalIqd,
      deliveryFeeIqd: quote.totals.deliveryFeeIqd,
      platformServiceFeeIqd: quote.totals.platformServiceFeeIqd,
      discountTotalIqd: quote.totals.discountTotalIqd,
      restaurantFundedDiscountIqd: quote.totals.restaurantFundedDiscountIqd,
      platformFundedDiscountIqd: quote.totals.platformFundedDiscountIqd,
      customerTotalIqd: quote.totals.customerTotalIqd,

      commissionBaseIqd: quote.totals.commissionBaseIqd,
      commissionFlatIqdSnapshot: quote.totals.commissionFlatIqdSnapshot,
      commissionAmountIqd: quote.totals.commissionAmountIqd,
      restaurantNetSnapshotIqd: quote.totals.restaurantNetIqd,

      customerNameSnapshot: customer.fullName ?? '',
      customerPhoneSnapshot: customer.phoneE164,
      deliveryAddressSnapshotJson: addressSnapshot,
      restaurantLocationSnapshotJson: restaurantSnapshot,
      customerNotes: input.customerNotes ?? null,

      deliveryPinHash: deliveryPin
        ? hashDeliveryPin(deliveryPin, orderId, ctx.env.OTP_HASH_PEPPER)
        : null,
      estimatedPreparationMinutes: openState.estimatedPreparationMinutes,
      placedAt: now,
    });

    for (const line of quote.lines) {
      const orderItemId = uuidv7();
      await tx.insert(orderItems).values({
        id: orderItemId,
        orderId,
        menuItemId: line.menuItemId,
        nameArSnapshot: line.nameArSnapshot,
        unitPriceIqdSnapshot: line.unitPriceIqdSnapshot,
        costPriceIqdSnapshot: line.costPriceIqdSnapshot,
        quantity: line.quantity,
        lineTotalIqd: line.lineTotalIqd,
        notes: line.notes,
      });

      if (line.modifiers.length > 0) {
        await tx.insert(orderItemModifiers).values(
          line.modifiers.map((modifier) => ({
            id: uuidv7(),
            orderItemId,
            modifierId: modifier.modifierId,
            groupNameArSnapshot: modifier.groupNameArSnapshot,
            nameArSnapshot: modifier.nameArSnapshot,
            priceIqdSnapshot: modifier.priceIqdSnapshot,
          })),
        );
      }
    }

    // 13. Reserve inventory (plan §27 step 13, §36).
    //
    // Deliberately after the order row exists so the reservation can reference
    // it, and inside the same transaction so an out-of-stock ingredient rolls
    // the whole order back rather than leaving a charge for food the kitchen
    // cannot make. Row locks here are what stop two simultaneous orders from
    // both claiming the last unit.
    const reservation = await reserveInventoryForOrder(tx, {
      orderId,
      branchId: input.branchId,
      lines: quote.lines.map((line) => ({
        menuItemId: line.menuItemId,
        quantity: line.quantity,
      })),
    });

    // 15. Status history.
    await tx.insert(orderStatusHistory).values([
      {
        id: uuidv7(),
        orderId,
        fromStatus: null,
        toStatus: 'PLACED',
        actorType: 'CUSTOMER',
        actorUserId: input.userId,
      },
      {
        id: uuidv7(),
        orderId,
        fromStatus: 'PLACED',
        toStatus: 'PENDING_RESTAURANT',
        actorType: 'SYSTEM',
        actorUserId: null,
      },
    ]);

    // 16. Outbox event, in the SAME transaction (plan §31).
    await enqueueOutboxEvent(tx, {
      eventType: EVENT_TYPES.ORDER_PLACED,
      aggregateType: 'order',
      aggregateId: orderId,
      aggregateVersion: 0,
      requestId: input.requestId,
      payload: {
        orderId,
        publicOrderNumber,
        restaurantId: input.restaurantId,
        branchId: input.branchId,
        customerId: input.userId,
        status: 'PENDING_RESTAURANT',
        customerTotalIqd: quote.totals.customerTotalIqd,
        itemCount: quote.lines.length,
        // First name only: a push body can appear on a locked screen (plan §107).
        customerFirstName: (customer.fullName ?? '').split(' ')[0] ?? '',
      },
    });

    // Low-stock alerts ride the same outbox as everything else (plan §31).
    for (const inventoryItemId of reservation.lowStockItemIds) {
      await enqueueOutboxEvent(tx, {
        eventType: EVENT_TYPES.INVENTORY_LOW_STOCK,
        aggregateType: 'inventory',
        aggregateId: inventoryItemId,
        requestId: input.requestId,
        payload: {
          inventoryItemId,
          restaurantId: input.restaurantId,
          branchId: input.branchId,
          orderId,
        },
      });
    }

    return {
      orderId,
      publicOrderNumber,
      customerTotalIqd: quote.totals.customerTotalIqd,
      status: 'PENDING_RESTAURANT' as OrderStatus,
      deliveryPin,
      estimatedPreparationMinutes: openState.estimatedPreparationMinutes,
    };
  });

  // 17–18. Commit has happened. Publishing is the worker's job.
  ctx.logger.info(
    {
      event: 'order.placed',
      orderId: result.orderId,
      restaurantId: input.restaurantId,
      requestId: input.requestId,
    },
    'Order placed',
  );

  return result;
}

/**
 * Apply a state transition to an order.
 *
 * Every restaurant/driver/admin command funnels through here: the transition
 * table decides legality, optimistic concurrency decides who wins a race, and
 * the history row plus outbox event are written with the change.
 */
export interface TransitionOrderInput {
  readonly orderId: string;
  readonly toStatus: OrderStatus;
  readonly actorType: ActorType;
  readonly actorUserId: string | null;
  readonly reason?: string | null;
  /** Version the client believes it is acting on (plan §32). */
  readonly expectedVersion?: number | null;
  readonly requestId: string;
  readonly eventType: (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];
  /** Extra column updates applied with the transition, e.g. timestamps. */
  readonly patch?: Record<string, unknown>;
}

const STATUS_TIMESTAMP_COLUMN: Partial<Record<OrderStatus, keyof typeof orders.$inferInsert>> = {
  ACCEPTED: 'acceptedAt',
  READY: 'readyAt',
  OUT_FOR_DELIVERY: 'outForDeliveryAt',
  DELIVERED: 'deliveredAt',
  COMPLETED: 'completedAt',
  CANCELLED: 'cancelledAt',
};

export async function transitionOrder(
  tx: Transaction,
  input: TransitionOrderInput,
): Promise<{ fromStatus: OrderStatus; version: number }> {
  // Lock the row so two cashiers cannot both win (plan §181).
  const [current] = await tx
    .select({
      id: orders.id,
      status: orders.status,
      version: orders.version,
      restaurantId: orders.restaurantId,
      branchId: orders.branchId,
      userId: orders.userId,
      publicOrderNumber: orders.publicOrderNumber,
      customerTotalIqd: orders.customerTotalIqd,
      customerNameSnapshot: orders.customerNameSnapshot,
    })
    .from(orders)
    .where(eq(orders.id, input.orderId))
    .for('update')
    .limit(1);

  if (!current) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'order' } });

  // Optimistic concurrency: the client acted on a view of the order, and if that
  // view is stale it must refresh rather than overwrite someone else's work.
  if (
    input.expectedVersion !== null &&
    input.expectedVersion !== undefined &&
    current.version !== input.expectedVersion
  ) {
    throw new AppError(ERROR_CODES.ORDER_ALREADY_UPDATED, {
      details: { currentVersion: current.version, currentStatus: current.status },
    });
  }

  assertTransition(
    ORDER_TRANSITIONS,
    {
      from: current.status,
      to: input.toStatus,
      actorType: input.actorType,
      reason: input.reason ?? null,
    },
    ERROR_CODES.ORDER_CANNOT_TRANSITION,
  );

  const now = new Date();
  const timestampColumn = STATUS_TIMESTAMP_COLUMN[input.toStatus];

  await tx
    .update(orders)
    .set({
      status: input.toStatus,
      version: sql`${orders.version} + 1`,
      updatedAt: now,
      ...(timestampColumn ? { [timestampColumn]: now } : {}),
      ...(input.patch ?? {}),
    })
    .where(eq(orders.id, input.orderId));

  await tx.insert(orderStatusHistory).values({
    id: uuidv7(),
    orderId: input.orderId,
    fromStatus: current.status,
    toStatus: input.toStatus,
    actorType: input.actorType,
    actorUserId: input.actorUserId,
    reason: input.reason ?? null,
  });

  await enqueueOutboxEvent(tx, {
    eventType: input.eventType,
    aggregateType: 'order',
    aggregateId: input.orderId,
    aggregateVersion: current.version + 1,
    requestId: input.requestId,
    payload: {
      orderId: current.id,
      publicOrderNumber: current.publicOrderNumber,
      restaurantId: current.restaurantId,
      branchId: current.branchId,
      customerId: current.userId,
      status: input.toStatus,
      customerTotalIqd: current.customerTotalIqd,
      itemCount: 0,
      customerFirstName: current.customerNameSnapshot.split(' ')[0] ?? '',
      reason: input.reason ?? null,
    },
  });

  return { fromStatus: current.status, version: current.version + 1 };
}
