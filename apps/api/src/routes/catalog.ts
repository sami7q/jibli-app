import { and, asc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, ERROR_CODES, success } from '@jibli/contracts';
import { normalizeArabicForSearch, searchQuerySchema, uuidSchema } from '@jibli/validation';
import { evaluateOpenState } from '@jibli/domain';
import {
  branchHourExceptions,
  branchWorkingHours,
  cities,
  governorates,
  itemModifierGroups,
  menuCategories,
  menuItems,
  modifierGroups,
  modifiers,
  restaurantBranches,
  restaurants,
} from '@jibli/db';
import type { AppContext } from '../lib/context.js';

/**
 * Public marketplace discovery and menus (plan §14, §18, §58).
 *
 * Every query is scoped to an ordering-enabled city. "Search never returns
 * orderable results from a disabled ordering city" (plan §58), and the filter
 * lives in the SQL rather than being applied after the fact, so paging cannot
 * leak a closed city's restaurant onto page two.
 */

const discoverQuerySchema = z.object({
  city_id: uuidSchema,
  q: searchQuerySchema.optional(),
  cuisine: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
});

export function registerCatalogRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * Restaurants available in a city.
   *
   * Returns only approved, active, open-city restaurants — the marketplace
   * eligibility conjunction of plan §18, expressed as a WHERE clause.
   */
  app.get('/api/v1/restaurants', async (request, reply) => {
    const query = discoverQuerySchema.parse(request.query);

    const conditions = [
      eq(restaurantBranches.cityId, query.city_id),
      eq(restaurantBranches.isActive, true),
      eq(restaurantBranches.acceptsOrders, true),
      eq(restaurants.onboardingStatus, 'APPROVED'),
      eq(restaurants.operationalStatus, 'ACTIVE'),
      // Geography gate — a closed city yields nothing, by construction.
      eq(cities.isEnabled, true),
      eq(cities.orderingEnabled, true),
      eq(governorates.isEnabled, true),
      eq(governorates.orderingEnabled, true),
      isNull(restaurants.deletedAt),
      isNull(restaurantBranches.deletedAt),
    ];

    if (query.q) {
      // Trigram search over the Arabic name. Normalisation folds alef variants
      // so "العراقى" finds "العراقي" (plan §58).
      const normalized = normalizeArabicForSearch(query.q);
      conditions.push(
        or(
          ilike(restaurants.displayName, `%${query.q}%`),
          sql`${restaurants.displayName} % ${normalized}`,
        ) as never,
      );
    }

    if (query.cuisine) {
      conditions.push(sql`${restaurants.cuisineTags} ? ${query.cuisine}` as never);
    }

    const rows = await ctx.db
      .select({
        restaurantId: restaurants.id,
        displayName: restaurants.displayName,
        descriptionAr: restaurants.descriptionAr,
        logoAssetId: restaurants.logoAssetId,
        coverAssetId: restaurants.coverAssetId,
        cuisineTags: restaurants.cuisineTags,
        ratingAverage: restaurants.ratingAverage,
        ratingCount: restaurants.ratingCount,
        minimumOrderIqd: restaurants.minimumOrderIqd,
        branchId: restaurantBranches.id,
        deliveryFeeIqd: restaurantBranches.deliveryFeeIqd,
        basePreparationMinutes: restaurantBranches.basePreparationMinutes,
        busyMode: restaurantBranches.busyMode,
        busyModeExpiresAt: restaurantBranches.busyModeExpiresAt,
        cityNameAr: cities.nameAr,
      })
      .from(restaurantBranches)
      .innerJoin(restaurants, eq(restaurantBranches.restaurantId, restaurants.id))
      .innerJoin(cities, eq(restaurantBranches.cityId, cities.id))
      .innerJoin(governorates, eq(cities.governorateId, governorates.id))
      .where(and(...conditions))
      /*
       * NULLS LAST is the whole point of writing this as a fragment.
       *
       * Postgres sorts NULLs *first* on DESC, so `desc(ratingAverage)` put
       * every unrated restaurant above every rated one — a partner approved
       * this morning outranked a 4.9 with three hundred reviews, on the first
       * screen of the app.
       */
      .orderBy(sql`${restaurants.ratingAverage} DESC NULLS LAST`, asc(restaurants.displayName))
      .limit(query.limit)
      .offset(query.offset);

    // Working hours decide open/closed for display. A closed restaurant still
    // appears — the customer can browse it — but checkout will refuse.
    const branchIds = rows.map((r) => r.branchId);
    const hoursByBranch = await loadHours(ctx, branchIds);

    const cards = rows.map((row) => {
      const hours = hoursByBranch.get(row.branchId) ?? { rules: [], exceptions: [] };
      const openState = evaluateOpenState({
        rules: hours.rules,
        exceptions: hours.exceptions,
        busyMode: row.busyMode,
        busyModeExpiresAt: row.busyModeExpiresAt,
        basePreparationMinutes: row.basePreparationMinutes,
      });

      return {
        id: row.restaurantId,
        branch_id: row.branchId,
        display_name: row.displayName,
        description_ar: row.descriptionAr,
        logo_asset_id: row.logoAssetId,
        cover_asset_id: row.coverAssetId,
        cuisine_tags: row.cuisineTags,
        rating: row.ratingAverage,
        rating_count: row.ratingCount,
        minimum_order_iqd: row.minimumOrderIqd,
        delivery_fee_iqd: row.deliveryFeeIqd,
        estimated_preparation_minutes: openState.estimatedPreparationMinutes,
        is_open: openState.isOpen,
        accepts_orders: openState.acceptsOrders,
        city_name_ar: row.cityNameAr,
      };
    });

    /*
     * Open restaurants first.
     *
     * Whether a branch is open cannot be expressed in the WHERE clause — it
     * comes out of the working-hours evaluation above — so it is applied here,
     * to the page that was fetched. Within each group the SQL order is kept,
     * so rating still decides.
     *
     * The honest limitation: this sorts the page, not the city. With the
     * default page of 20 and a pilot city of a few dozen restaurants that is
     * the same thing; it stops being so the day a city outgrows one page, and
     * the fix then is a generated `accepts_orders` column rather than a bigger
     * page.
     */
    const data = [...cards].sort(
      (left, right) => Number(right.accepts_orders) - Number(left.accepts_orders),
    );

    return reply.send(
      success(data, {
        request_id: request.requestId,
        has_more: rows.length === query.limit,
        page_size: query.limit,
      }),
    );
  });

  /**
   * Search dishes across a city — «دجاج» finds every chicken dish on offer.
   *
   * Discovery searched restaurant names only, so a customer who wants chicken
   * and does not know which restaurant sells it finds nothing. This searches
   * the menu and answers with dishes, each carrying the restaurant it belongs
   * to, so the result is something that can be ordered rather than a list of
   * places that might have it.
   *
   * Ordered open-first, then by rating: the customer wants dinner now, and a
   * dish from a kitchen that is shut is a worse answer than one from a kitchen
   * that is cooking, whatever its name.
   */
  app.get('/api/v1/menu/search', async (request, reply) => {
    const query = z
      .object({
        city_id: uuidSchema,
        q: searchQuerySchema,
        limit: z.coerce.number().int().min(1).max(60).default(30),
      })
      .parse(request.query);

    const term = `%${query.q}%`;
    const normalized = `%${normalizeArabicForSearch(query.q)}%`;

    const rows = await ctx.db
      .select({
        itemId: menuItems.id,
        nameAr: menuItems.nameAr,
        descriptionAr: menuItems.descriptionAr,
        priceIqd: menuItems.basePriceIqd,
        imageAssetId: menuItems.imageAssetId,
        isAvailable: menuItems.isAvailable,
        isPopular: menuItems.isPopular,
        restaurantId: restaurants.id,
        branchId: restaurantBranches.id,
        restaurantName: restaurants.displayName,
        coverAssetId: restaurants.coverAssetId,
        ratingAverage: restaurants.ratingAverage,
        deliveryFeeIqd: restaurantBranches.deliveryFeeIqd,
        minimumOrderIqd: restaurants.minimumOrderIqd,
        basePreparationMinutes: restaurantBranches.basePreparationMinutes,
        acceptsOrders: restaurantBranches.acceptsOrders,
        busyMode: restaurantBranches.busyMode,
        busyModeExpiresAt: restaurantBranches.busyModeExpiresAt,
      })
      .from(menuItems)
      .innerJoin(restaurants, eq(menuItems.restaurantId, restaurants.id))
      .innerJoin(restaurantBranches, eq(restaurantBranches.restaurantId, restaurants.id))
      .innerJoin(cities, eq(restaurantBranches.cityId, cities.id))
      .innerJoin(governorates, eq(cities.governorateId, governorates.id))
      .where(
        and(
          // The same marketplace eligibility as discovery: a dish from a
          // suspended restaurant must not be findable by another route.
          eq(restaurantBranches.cityId, query.city_id),
          eq(restaurantBranches.isActive, true),
          eq(restaurants.onboardingStatus, 'APPROVED'),
          eq(restaurants.operationalStatus, 'ACTIVE'),
          eq(cities.isEnabled, true),
          eq(cities.orderingEnabled, true),
          eq(governorates.isEnabled, true),
          eq(governorates.orderingEnabled, true),
          eq(menuItems.isActive, true),
          isNull(menuItems.deletedAt),
          isNull(restaurants.deletedAt),
          isNull(restaurantBranches.deletedAt),
          or(
            ilike(menuItems.nameAr, term),
            ilike(menuItems.nameAr, normalized),
            ilike(menuItems.descriptionAr, term),
            // The restaurant's own name, so «برجر بغداد» finds its whole menu.
            ilike(restaurants.displayName, term),
          ),
        ),
      )
      .orderBy(sql`${restaurants.ratingAverage} DESC NULLS LAST`, asc(menuItems.sortOrder))
      .limit(query.limit);

    const hoursByBranch = await loadHours(ctx, [...new Set(rows.map((row) => row.branchId))]);

    const dishes = rows.map((row) => {
      const hours = hoursByBranch.get(row.branchId) ?? { rules: [], exceptions: [] };
      const openState = evaluateOpenState({
        rules: hours.rules,
        exceptions: hours.exceptions,
        busyMode: row.busyMode,
        busyModeExpiresAt: row.busyModeExpiresAt,
        basePreparationMinutes: row.basePreparationMinutes,
      });

      return {
        id: row.itemId,
        name_ar: row.nameAr,
        description_ar: row.descriptionAr,
        price_iqd: row.priceIqd,
        image_asset_id: row.imageAssetId,
        is_available: row.isAvailable,
        is_popular: row.isPopular,
        restaurant: {
          id: row.restaurantId,
          branch_id: row.branchId,
          display_name: row.restaurantName,
          cover_asset_id: row.coverAssetId,
          rating: row.ratingAverage,
          delivery_fee_iqd: row.deliveryFeeIqd,
          minimum_order_iqd: row.minimumOrderIqd,
          estimated_preparation_minutes: openState.estimatedPreparationMinutes,
          is_open: openState.isOpen,
          accepts_orders: row.acceptsOrders && openState.acceptsOrders,
        },
      };
    });

    /*
     * Open kitchens first.
     *
     * Not expressible in ORDER BY — whether a branch is open comes out of the
     * working-hours evaluation above — so it is applied to the page that was
     * fetched. Within each group the SQL order holds, so rating still decides.
     */
    const data = [...dishes].sort(
      (left, right) =>
        Number(right.restaurant.accepts_orders) - Number(left.restaurant.accepts_orders),
    );

    return reply.send(
      success(data, { request_id: request.requestId, page_size: query.limit }),
    );
  });

  /** Restaurant detail with its full menu. */
  app.get('/api/v1/restaurants/:restaurantId', async (request, reply) => {
    const { restaurantId } = z.object({ restaurantId: uuidSchema }).parse(request.params);

    const [row] = await ctx.db
      .select({
        restaurant: restaurants,
        branch: restaurantBranches,
        cityNameAr: cities.nameAr,
        cityOrderingEnabled: cities.orderingEnabled,
        cityIsEnabled: cities.isEnabled,
        governorateOrderingEnabled: governorates.orderingEnabled,
        governorateIsEnabled: governorates.isEnabled,
      })
      .from(restaurants)
      .innerJoin(restaurantBranches, eq(restaurantBranches.restaurantId, restaurants.id))
      .innerJoin(cities, eq(restaurantBranches.cityId, cities.id))
      .innerJoin(governorates, eq(cities.governorateId, governorates.id))
      .where(and(eq(restaurants.id, restaurantId), isNull(restaurants.deletedAt)))
      .limit(1);

    if (!row) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'restaurant' } });

    // An unapproved or suspended restaurant is not public at all — 404 rather
    // than 403, so its existence is not confirmed to a stranger.
    if (row.restaurant.onboardingStatus !== 'APPROVED' || row.restaurant.deletedAt) {
      throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'restaurant' } });
    }

    const categories = await ctx.db
      .select()
      .from(menuCategories)
      .where(
        and(
          eq(menuCategories.restaurantId, restaurantId),
          eq(menuCategories.isActive, true),
          isNull(menuCategories.deletedAt),
        ),
      )
      .orderBy(asc(menuCategories.sortOrder));

    const items = await ctx.db
      .select()
      .from(menuItems)
      .where(
        and(
          eq(menuItems.restaurantId, restaurantId),
          eq(menuItems.isActive, true),
          isNull(menuItems.deletedAt),
        ),
      )
      .orderBy(asc(menuItems.sortOrder));

    const hoursByBranch = await loadHours(ctx, [row.branch.id]);
    const hours = hoursByBranch.get(row.branch.id) ?? { rules: [], exceptions: [] };
    const openState = evaluateOpenState({
      rules: hours.rules,
      exceptions: hours.exceptions,
      busyMode: row.branch.busyMode,
      busyModeExpiresAt: row.branch.busyModeExpiresAt,
      basePreparationMinutes: row.branch.basePreparationMinutes,
    });

    const orderable =
      row.restaurant.operationalStatus === 'ACTIVE' &&
      row.branch.isActive &&
      row.branch.acceptsOrders &&
      row.cityIsEnabled &&
      row.cityOrderingEnabled &&
      row.governorateIsEnabled &&
      row.governorateOrderingEnabled &&
      openState.acceptsOrders;

    return reply.send(
      success(
        {
          id: row.restaurant.id,
          branch_id: row.branch.id,
          display_name: row.restaurant.displayName,
          description_ar: row.restaurant.descriptionAr,
          logo_asset_id: row.restaurant.logoAssetId,
          cover_asset_id: row.restaurant.coverAssetId,
          cuisine_tags: row.restaurant.cuisineTags,
          rating: row.restaurant.ratingAverage,
          rating_count: row.restaurant.ratingCount,
          minimum_order_iqd: row.restaurant.minimumOrderIqd,
          delivery_fee_iqd: row.branch.deliveryFeeIqd,
          menu_version: row.restaurant.menuVersion,
          address_text: row.branch.addressText,
          city_name_ar: row.cityNameAr,
          is_open: openState.isOpen,
          orderable,
          estimated_preparation_minutes: openState.estimatedPreparationMinutes,
          categories: categories.map((category) => ({
            id: category.id,
            name_ar: category.nameAr,
            description_ar: category.descriptionAr,
            items: items
              .filter((item) => item.categoryId === category.id)
              .map((item) => ({
                id: item.id,
                name_ar: item.nameAr,
                description_ar: item.descriptionAr,
                price_iqd: item.basePriceIqd,
                image_asset_id: item.imageAssetId,
                is_available: item.isAvailable,
                is_popular: item.isPopular,
                // Cost price is restaurant-private and never leaves here (plan §39).
              })),
          })),
        },
        { request_id: request.requestId },
      ),
    );
  });

  /** Modifier groups for one item, fetched when the customer opens it. */
  app.get('/api/v1/catalog/items/:itemId/modifiers', async (request, reply) => {
    const { itemId } = z.object({ itemId: uuidSchema }).parse(request.params);

    const rows = await ctx.db
      .select({
        groupId: modifierGroups.id,
        groupNameAr: modifierGroups.nameAr,
        minSelect: modifierGroups.minSelect,
        maxSelect: modifierGroups.maxSelect,
        isRequired: modifierGroups.isRequired,
        sortOrder: modifierGroups.sortOrder,
        modifierId: modifiers.id,
        modifierNameAr: modifiers.nameAr,
        modifierPriceIqd: modifiers.priceIqd,
        modifierAvailable: modifiers.isAvailable,
      })
      .from(itemModifierGroups)
      .innerJoin(modifierGroups, eq(itemModifierGroups.groupId, modifierGroups.id))
      .leftJoin(modifiers, eq(modifiers.groupId, modifierGroups.id))
      .where(and(eq(itemModifierGroups.itemId, itemId), eq(modifierGroups.isActive, true)))
      .orderBy(asc(modifierGroups.sortOrder), asc(modifiers.sortOrder));

    const grouped = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const group = grouped.get(row.groupId) ?? {
        id: row.groupId,
        name_ar: row.groupNameAr,
        min_select: row.minSelect,
        max_select: row.maxSelect,
        is_required: row.isRequired,
        modifiers: [] as unknown[],
      };
      if (row.modifierId) {
        (group.modifiers as unknown[]).push({
          id: row.modifierId,
          name_ar: row.modifierNameAr,
          price_iqd: row.modifierPriceIqd,
          is_available: row.modifierAvailable,
        });
      }
      grouped.set(row.groupId, group);
    }

    return reply.send(success([...grouped.values()], { request_id: request.requestId }));
  });
}

/** Load weekly hours and dated exceptions for a set of branches. */
export async function loadHours(ctx: AppContext, branchIds: string[]) {
  const map = new Map<
    string,
    {
      rules: { dayOfWeek: number; opensAtMinute: number; closesAtMinute: number; isClosed: boolean }[];
      exceptions: {
        localDate: string;
        isClosed: boolean;
        opensAtMinute: number | null;
        closesAtMinute: number | null;
      }[];
    }
  >();
  if (branchIds.length === 0) return map;

  const rules = await ctx.db
    .select()
    .from(branchWorkingHours)
    .where(inArray(branchWorkingHours.branchId, branchIds));

  const exceptions = await ctx.db
    .select()
    .from(branchHourExceptions)
    .where(inArray(branchHourExceptions.branchId, branchIds));

  for (const id of branchIds) map.set(id, { rules: [], exceptions: [] });

  for (const rule of rules) {
    map.get(rule.branchId)?.rules.push({
      dayOfWeek: rule.dayOfWeek,
      opensAtMinute: rule.opensAtMinute,
      closesAtMinute: rule.closesAtMinute,
      isClosed: rule.isClosed,
    });
  }
  for (const exception of exceptions) {
    map.get(exception.branchId)?.exceptions.push({
      localDate: exception.localDate,
      isClosed: exception.isClosed,
      opensAtMinute: exception.opensAtMinute,
      closesAtMinute: exception.closesAtMinute,
    });
  }

  return map;
}
