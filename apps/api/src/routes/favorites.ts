import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, ERROR_CODES, success } from '@jibli/contracts';
import { uuidSchema } from '@jibli/validation';
import { evaluateOpenState } from '@jibli/domain';
import { cities, customerFavorites, restaurantBranches, restaurants, uuidv7 } from '@jibli/db';
import type { AppContext } from '../lib/context.js';
import { requirePrincipal } from '../plugins/auth.js';
import { loadHours } from './catalog.js';

/**
 * Favourite restaurants.
 *
 * The table has existed since the first migration with nothing writing to it.
 * The customer app's fourth tab is what needed it — a list you curate yourself
 * is the one part of the home screen Admin does not arrange.
 *
 *   GET    /api/v1/favorites
 *   PUT    /api/v1/favorites/{restaurantId}
 *   DELETE /api/v1/favorites/{restaurantId}
 */

export function registerFavoriteRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * My favourites, shaped exactly like a discovery card.
   *
   * The same shape as `GET /restaurants` on purpose: the favourites tab renders
   * with the same component as the home screen, and a second card shape would
   * be a second place for the two lists to disagree about what a restaurant
   * looks like.
   */
  app.get('/api/v1/favorites', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);

    const rows = await ctx.db
      .select({
        favoritedAt: customerFavorites.createdAt,
        restaurant: restaurants,
        branch: restaurantBranches,
        cityNameAr: cities.nameAr,
      })
      .from(customerFavorites)
      .innerJoin(restaurants, eq(restaurants.id, customerFavorites.restaurantId))
      .innerJoin(restaurantBranches, eq(restaurantBranches.restaurantId, restaurants.id))
      .innerJoin(cities, eq(cities.id, restaurantBranches.cityId))
      .where(
        and(
          eq(customerFavorites.userId, principal.userId),
          // A restaurant that has left the platform disappears from the list
          // rather than showing as a card that cannot be opened.
          eq(restaurants.onboardingStatus, 'APPROVED'),
          isNull(restaurants.deletedAt),
          isNull(restaurantBranches.deletedAt),
        ),
      )
      .orderBy(desc(customerFavorites.createdAt));

    /*
     * One card per restaurant, not per branch.
     *
     * The join multiplies a restaurant by its branches, and a restaurant with
     * two of them would appear twice with the same id — which is a duplicate
     * card and a React key collision. Discovery does not hit this because it
     * filters to one city; a favourite is not scoped to anything.
     */
    const unique = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!unique.has(row.restaurant.id)) unique.set(row.restaurant.id, row);
    }
    const cards = [...unique.values()];

    const hoursByBranch = await loadHours(
      ctx,
      cards.map((row) => row.branch.id),
    );

    return reply.send(
      success(
        cards.map((row) => {
          const hours = hoursByBranch.get(row.branch.id) ?? { rules: [], exceptions: [] };
          const openState = evaluateOpenState({
            rules: hours.rules,
            exceptions: hours.exceptions,
            busyMode: row.branch.busyMode,
            busyModeExpiresAt: row.branch.busyModeExpiresAt,
            basePreparationMinutes: row.branch.basePreparationMinutes,
          });

          return {
            id: row.restaurant.id,
            branch_id: row.branch.id,
            display_name: row.restaurant.displayName,
            description_ar: row.restaurant.descriptionAr,
            cover_asset_id: row.restaurant.coverAssetId,
            cuisine_tags: row.restaurant.cuisineTags,
            rating: row.restaurant.ratingAverage,
            rating_count: row.restaurant.ratingCount,
            minimum_order_iqd: row.restaurant.minimumOrderIqd,
            delivery_fee_iqd: row.branch.deliveryFeeIqd,
            estimated_preparation_minutes: openState.estimatedPreparationMinutes,
            is_open: openState.isOpen,
            accepts_orders: row.branch.acceptsOrders && openState.acceptsOrders,
            city_name_ar: row.cityNameAr,
            favorited_at: row.favoritedAt,
          };
        }),
        { request_id: request.requestId },
      ),
    );
  });

  /**
   * Favourite a restaurant. Idempotent: tapping the heart twice from two
   * screens is one favourite, not an error the customer has to understand.
   */
  app.put(
    '/api/v1/favorites/:restaurantId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      const { restaurantId } = z.object({ restaurantId: uuidSchema }).parse(request.params);

      const [restaurant] = await ctx.db
        .select({ id: restaurants.id })
        .from(restaurants)
        .where(
          and(
            eq(restaurants.id, restaurantId),
            eq(restaurants.onboardingStatus, 'APPROVED'),
            isNull(restaurants.deletedAt),
          ),
        )
        .limit(1);

      if (!restaurant) {
        throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'restaurant' } });
      }

      await ctx.db
        .insert(customerFavorites)
        .values({ id: uuidv7(), userId: principal.userId, restaurantId })
        .onConflictDoNothing({
          target: [customerFavorites.userId, customerFavorites.restaurantId],
        });

      return reply.send(success({ favorited: true }, { request_id: request.requestId }));
    },
  );

  app.delete(
    '/api/v1/favorites/:restaurantId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      const { restaurantId } = z.object({ restaurantId: uuidSchema }).parse(request.params);

      await ctx.db
        .delete(customerFavorites)
        .where(
          and(
            eq(customerFavorites.userId, principal.userId),
            eq(customerFavorites.restaurantId, restaurantId),
          ),
        );

      // No 404 for a favourite that was not there: the customer asked for it to
      // be gone, and it is gone.
      return reply.send(success({ favorited: false }, { request_id: request.requestId }));
    },
  );
}
