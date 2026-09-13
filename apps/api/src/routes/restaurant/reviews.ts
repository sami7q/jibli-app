import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { success } from '@jibli/contracts';
import { orderReviews, orders, restaurants, users } from '@jibli/db';
import type { AppContext } from '../../lib/context.js';
import { restaurantScope } from './scope.js';

/**
 * What customers said, for the restaurant that cooked it.
 *
 * Read-only and deliberately so. A restaurant that could reply in public, edit,
 * or remove a rating would turn the number customers rely on into something the
 * restaurant curates; a restaurant that disagrees with one opens a support
 * thread, where a person looks at it.
 *
 * Hidden reviews are not returned. A moderator hid it, and showing the
 * restaurant something the public cannot see invites an argument about a text
 * that no longer counts toward anything.
 */

export function registerRestaurantReviewRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(
    '/api/v1/restaurant-portal/reviews',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { restaurantId } = restaurantScope(request);
      const query = z
        .object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
          min_rating: z.coerce.number().int().min(1).max(5).optional(),
          max_rating: z.coerce.number().int().min(1).max(5).optional(),
        })
        .parse(request.query);

      const conditions = [
        eq(orderReviews.restaurantId, restaurantId),
        eq(orderReviews.isHidden, false),
      ];
      if (query.min_rating !== undefined) {
        conditions.push(gte(orderReviews.rating, query.min_rating));
      }
      if (query.max_rating !== undefined) {
        conditions.push(lte(orderReviews.rating, query.max_rating));
      }

      const rows = await ctx.db
        .select({
          id: orderReviews.id,
          rating: orderReviews.rating,
          comment: orderReviews.comment,
          createdAt: orderReviews.createdAt,
          publicOrderNumber: orders.publicOrderNumber,
          authorName: users.fullName,
        })
        .from(orderReviews)
        .innerJoin(orders, eq(orders.id, orderReviews.orderId))
        .leftJoin(users, eq(users.id, orderReviews.userId))
        .where(and(...conditions))
        .orderBy(desc(orderReviews.createdAt))
        .limit(query.limit);

      /*
       * The distribution, not just the average. "4.2" says nothing about
       * whether that is everyone giving four, or half giving five and half
       * giving two — and those are different restaurants with different
       * problems.
       */
      const spread = await ctx.db
        .select({
          rating: orderReviews.rating,
          total: sql<number>`COUNT(*)`,
        })
        .from(orderReviews)
        .where(
          and(eq(orderReviews.restaurantId, restaurantId), eq(orderReviews.isHidden, false)),
        )
        .groupBy(orderReviews.rating);

      const [restaurant] = await ctx.db
        .select({
          ratingAverage: restaurants.ratingAverage,
          ratingCount: restaurants.ratingCount,
        })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

      const distribution: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      for (const row of spread) distribution[String(row.rating)] = Number(row.total);

      return reply.send(
        success(
          {
            rating: restaurant?.ratingAverage ?? null,
            rating_count: restaurant?.ratingCount ?? 0,
            distribution,
            reviews: rows.map((row) => ({
              id: row.id,
              rating: row.rating,
              comment: row.comment,
              public_order_number: row.publicOrderNumber,
              // First name only, as on the public listing. The restaurant does
              // not need the customer's full name to read their opinion.
              author_name: row.authorName?.trim().split(/\s+/)[0] ?? 'عميل',
              created_at: row.createdAt.toISOString(),
            })),
          },
          { request_id: request.requestId },
        ),
      );
    },
  );
}
