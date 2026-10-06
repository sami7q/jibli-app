import { and, eq, inArray, isNull } from 'drizzle-orm';
import { AppError, ERROR_CODES } from '@jibli/contracts';
import {
  assertAddressServiceable,
  assertOrderable,
  buildQuote,
  resolveCommissionFee,
  type CatalogItem,
  type Quote,
  type RequestedLine,
} from '@jibli/domain';
import {
  branchHourExceptions,
  branchWorkingHours,
  cities,
  governorates,
  itemModifierGroups,
  menuItems,
  modifierGroups,
  modifiers,
  restaurantBranches,
  restaurantCommissionConfigs,
  restaurants,
  userAddresses,
  type DbExecutor,
} from '@jibli/db';
import type { AppContext } from '../lib/context.js';
import { getConfig } from './config-service.js';

/**
 * Read-only checkout quote (plan §22).
 *
 * Runs the same validation and pricing as PlaceOrder but writes nothing, so the
 * customer sees exactly what they will be charged — and sees a closed city or a
 * sold-out item *before* they tap the confirm button rather than after.
 */

export interface QuoteOrderInput {
  readonly userId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly addressId: string;
  readonly lines: readonly RequestedLine[];
}

export interface QuoteOrderResult extends Quote {
  readonly estimatedPreparationMinutes: number;
}

/** Shared by the quote endpoint and PlaceOrder so pricing cannot diverge. */
export async function loadCatalogForPricing(
  executor: DbExecutor,
  restaurantId: string,
  itemIds: readonly string[],
): Promise<Map<string, CatalogItem>> {
  if (itemIds.length === 0) return new Map();

  const itemRows = await executor
    .select({
      id: menuItems.id,
      restaurantId: menuItems.restaurantId,
      nameAr: menuItems.nameAr,
      basePriceIqd: menuItems.basePriceIqd,
      costPriceIqd: menuItems.costPriceIqd,
      isActive: menuItems.isActive,
      isAvailable: menuItems.isAvailable,
    })
    .from(menuItems)
    .where(and(inArray(menuItems.id, [...itemIds]), isNull(menuItems.deletedAt)));

  const groupRows = await executor
    .select({
      itemId: itemModifierGroups.itemId,
      groupId: modifierGroups.id,
      groupNameAr: modifierGroups.nameAr,
      minSelect: modifierGroups.minSelect,
      maxSelect: modifierGroups.maxSelect,
      isRequired: modifierGroups.isRequired,
      groupActive: modifierGroups.isActive,
      groupRestaurantId: modifierGroups.restaurantId,
      modifierId: modifiers.id,
      modifierNameAr: modifiers.nameAr,
      modifierPriceIqd: modifiers.priceIqd,
      modifierAvailable: modifiers.isAvailable,
    })
    .from(itemModifierGroups)
    .innerJoin(modifierGroups, eq(itemModifierGroups.groupId, modifierGroups.id))
    .leftJoin(modifiers, eq(modifiers.groupId, modifierGroups.id))
    .where(inArray(itemModifierGroups.itemId, [...itemIds]));

  type Group = CatalogItem['modifierGroups'][number];
  const groupsByItem = new Map<string, Map<string, Group>>();

  for (const row of groupRows) {
    // A modifier group from another restaurant can never attach to this item.
    if (row.groupRestaurantId !== restaurantId) continue;

    const itemGroups = groupsByItem.get(row.itemId) ?? new Map<string, Group>();
    const existing =
      itemGroups.get(row.groupId) ??
      ({
        id: row.groupId,
        nameAr: row.groupNameAr,
        minSelect: row.minSelect,
        maxSelect: row.maxSelect,
        isRequired: row.isRequired,
        isActive: row.groupActive,
        modifiers: [],
      } as Group);

    if (row.modifierId) {
      (
        existing.modifiers as {
          id: string;
          groupId: string;
          nameAr: string;
          priceIqd: number;
          isAvailable: boolean;
        }[]
      ).push({
        id: row.modifierId,
        groupId: row.groupId,
        nameAr: row.modifierNameAr ?? '',
        priceIqd: row.modifierPriceIqd ?? 0,
        isAvailable: row.modifierAvailable ?? false,
      });
    }

    itemGroups.set(row.groupId, existing);
    groupsByItem.set(row.itemId, itemGroups);
  }

  return new Map(
    itemRows.map((item) => [
      item.id,
      { ...item, modifierGroups: [...(groupsByItem.get(item.id)?.values() ?? [])] },
    ]),
  );
}

export async function quoteOrder(
  ctx: AppContext,
  input: QuoteOrderInput,
): Promise<QuoteOrderResult> {
  const globalCheckoutEnabled = await getConfig(ctx, 'global_checkout_enabled', true);
  const platformServiceFeeIqd = await getConfig(ctx, 'platform_service_fee_iqd', 1000);

  const [address] = await ctx.db
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

  if (!address) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'address' } });

  const [branchRow] = await ctx.db
    .select({
      branch: restaurantBranches,
      restaurant: {
        id: restaurants.id,
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

  const workingHours = await ctx.db
    .select()
    .from(branchWorkingHours)
    .where(eq(branchWorkingHours.branchId, input.branchId));

  const exceptions = await ctx.db
    .select()
    .from(branchHourExceptions)
    .where(eq(branchHourExceptions.branchId, input.branchId));

  const openState = assertOrderable({
    globalCheckoutEnabled,
    geography: { city: branchRow.city, governorate: branchRow.governorate },
    restaurant: branchRow.restaurant,
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

  assertAddressServiceable({
    branch: {
      cityId: branchRow.branch.cityId,
      latitude: branchRow.branch.latitude,
      longitude: branchRow.branch.longitude,
      serviceRadiusMeters: branchRow.branch.serviceRadiusMeters,
    },
    address: { cityId: address.cityId, latitude: address.latitude, longitude: address.longitude },
  });

  const catalog = await loadCatalogForPricing(
    ctx.db,
    input.restaurantId,
    input.lines.map((l) => l.menuItemId),
  );

  const commissionConfigs = await ctx.db
    .select({
      commissionFlatIqd: restaurantCommissionConfigs.commissionFlatIqd,
      effectiveFrom: restaurantCommissionConfigs.effectiveFrom,
      effectiveTo: restaurantCommissionConfigs.effectiveTo,
    })
    .from(restaurantCommissionConfigs)
    .where(eq(restaurantCommissionConfigs.restaurantId, input.restaurantId));

  const quote = buildQuote({
    restaurantId: input.restaurantId,
    requestedLines: input.lines,
    catalog,
    deliveryFeeIqd: branchRow.branch.deliveryFeeIqd,
    platformServiceFeeIqd,
    commissionFlatIqd: resolveCommissionFee(commissionConfigs, new Date()),
    minimumOrderIqd: branchRow.restaurant.minimumOrderIqd,
  });

  return { ...quote, estimatedPreparationMinutes: openState.estimatedPreparationMinutes };
}
