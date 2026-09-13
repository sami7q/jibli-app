import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { success } from '@jibli/contracts';
import { uuidSchema } from '@jibli/validation';
import { orderReviews, orders, restaurants, users } from '@jibli/db';
import type { AppContext } from '../lib/context.js';
import { requirePrincipal } from '../plugins/auth.js';
import {
  pendingReviews,
  reviewEligibility,
  submitReview,
} from '../services/review-service.js';
import { notifyAdmins } from '../services/admin-notification-service.js';

/**
 * Rating an order, from the customer's side.
 *
 * Everything that decides *whether* a rating is allowed lives in
 * review-service; these routes are the surface. That split matters because the
 * same rules have to hold for the mobile app, and a rule written in a route
 * handler is a rule the next client re-implements slightly differently.
 */

export function registerReviewRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * Can I rate this order, and if not, when?
   *
   * The app calls this to decide between showing the stars, showing "you can
   * rate this in 12 minutes", or showing nothing. A boolean would collapse
   * the middle case into the last one.
   */
  app.get(
    '/api/v1/orders/:orderId/review-eligibility',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      const { orderId } = z.object({ orderId: uuidSchema }).parse(request.params);

      return reply.send(
        success(
          await reviewEligibility(ctx, { orderId, userId: principal.userId }),
          { request_id: request.requestId },
        ),
      );
    },
  );

  /** Orders waiting to be rated. What the "rate your last order" prompt reads. */
  app.get('/api/v1/reviews/pending', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    return reply.send(
      success(await pendingReviews(ctx, principal.userId), { request_id: request.requestId }),
    );
  });

  app.post(
    '/api/v1/orders/:orderId/review',
    {
      preHandler: app.authenticate,
      // A customer rates the orders they placed; anything beyond this rate is
      // not a person tapping stars.
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      const { orderId } = z.object({ orderId: uuidSchema }).parse(request.params);
      const body = z
        .object({
          rating: z.number().int().min(1).max(5),
          comment: z.string().trim().max(1000).optional(),
        })
        .parse(request.body);

      const stats = await submitReview(ctx, {
        orderId,
        userId: principal.userId,
        rating: body.rating,
        comment: body.comment ?? null,
      });

      /*
       * A low rating is the one an operator wants to see the day it lands, not
       * in a monthly report. Three stars or fewer raises the bell; the rest
       * only move the average.
       */
      if (body.rating <= 2) {
        const [order] = await ctx.db
          .select({
            restaurantId: orders.restaurantId,
            restaurantName: restaurants.displayName,
            publicOrderNumber: orders.publicOrderNumber,
          })
          .from(orders)
          .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
          .where(eq(orders.id, orderId))
          .limit(1);

        if (order) {
          await notifyAdmins(ctx, {
            kind: 'REVIEW_POSTED',
            severity: 'ATTENTION',
            titleAr: `تقييم منخفض (${body.rating}/5) — ${order.restaurantName}`,
            bodyAr: body.comment?.slice(0, 140) ?? `الطلب #${order.publicOrderNumber}`,
            linkPath: `/restaurants/${order.restaurantId}`,
            entityType: 'order_review',
            entityId: orderId,
            restaurantId: order.restaurantId,
          });
        }
      }

      return reply.status(201).send(
        success(
          {
            recorded: true,
            restaurant_rating: stats.average,
            restaurant_rating_count: stats.count,
            note_ar: 'شكراً لتقييمك.',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * A restaurant's public reviews.
   *
   * Unauthenticated: this is what a customer reads before ordering, and
   * requiring a session to read a rating would make the listing screen useless
   * to someone who has not signed up yet.
   */
  app.get('/api/v1/restaurants/:restaurantId/reviews', async (request, reply) => {
    const { restaurantId } = z.object({ restaurantId: uuidSchema }).parse(request.params);
    const query = z
      .object({ limit: z.coerce.number().int().min(1).max(50).default(20) })
      .parse(request.query);

    const rows = await ctx.db
      .select({
        id: orderReviews.id,
        rating: orderReviews.rating,
        comment: orderReviews.comment,
        createdAt: orderReviews.createdAt,
        authorName: users.fullName,
      })
      .from(orderReviews)
      .leftJoin(users, eq(users.id, orderReviews.userId))
      .where(
        and(eq(orderReviews.restaurantId, restaurantId), eq(orderReviews.isHidden, false)),
      )
      .orderBy(desc(orderReviews.createdAt))
      .limit(query.limit);

    const [restaurant] = await ctx.db
      .select({
        ratingAverage: restaurants.ratingAverage,
        ratingCount: restaurants.ratingCount,
      })
      .from(restaurants)
      .where(eq(restaurants.id, restaurantId))
      .limit(1);

    return reply.send(
      success(
        {
          rating: restaurant?.ratingAverage ?? null,
          rating_count: restaurant?.ratingCount ?? 0,
          reviews: rows.map((row) => ({
            id: row.id,
            rating: row.rating,
            comment: row.comment,
            // First name only: a review is public, and the full name of
            // someone who ordered food is not ours to publish.
            author_name: firstName(row.authorName),
            created_at: row.createdAt.toISOString(),
          })),
        },
        { request_id: request.requestId },
      ),
    );
  });
}

function firstName(fullName: string | null): string {
  if (!fullName) return 'عميل';
  const [first] = fullName.trim().split(/\s+/);
  return first || 'عميل';
}
