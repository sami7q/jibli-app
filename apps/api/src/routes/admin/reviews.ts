import { and, desc, eq, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { success } from '@jibli/contracts';
import { assertAdminPermission } from '@jibli/auth';
import { reasonSchema, uuidSchema } from '@jibli/validation';
import { AUDIT_ACTIONS, writeAudit } from '@jibli/domain';
import { orderReviews, orders, restaurants, users } from '@jibli/db';
import { clientIp, userAgent, type AppContext } from '../../lib/context.js';
import { requirePrincipal } from '../../plugins/auth.js';
import { setReviewHidden } from '../../services/review-service.js';
import { moderationQueue, resolveReview } from '../../services/review-moderation-service.js';

/**
 * Moderating ratings.
 *
 * Hiding, never deleting. A deleted review is an accusation that cannot be
 * reviewed later — and the one case where moderation is contested is exactly
 * the case where the original text matters. Hidden reviews stop counting
 * toward the restaurant's average the moment they are hidden, which is why the
 * average is recomputed rather than adjusted.
 */

export function registerAdminReviewRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/v1/admin/reviews', { preHandler: app.authenticate }, async (request, reply) => {
    assertAdminPermission(requirePrincipal(request), 'restaurant.read');

    const query = z
      .object({
        restaurant_id: uuidSchema.optional(),
        /** Low ratings are what moderation is usually about. */
        max_rating: z.coerce.number().int().min(1).max(5).optional(),
        hidden: z.coerce.boolean().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);

    const conditions = [];
    if (query.restaurant_id) conditions.push(eq(orderReviews.restaurantId, query.restaurant_id));
    if (query.max_rating !== undefined) {
      conditions.push(lte(orderReviews.rating, query.max_rating));
    }
    if (query.hidden !== undefined) conditions.push(eq(orderReviews.isHidden, query.hidden));

    const rows = await ctx.db
      .select({
        id: orderReviews.id,
        rating: orderReviews.rating,
        comment: orderReviews.comment,
        isHidden: orderReviews.isHidden,
        createdAt: orderReviews.createdAt,
        restaurantId: restaurants.id,
        restaurantName: restaurants.displayName,
        publicOrderNumber: orders.publicOrderNumber,
        authorName: users.fullName,
      })
      .from(orderReviews)
      .innerJoin(restaurants, eq(restaurants.id, orderReviews.restaurantId))
      .innerJoin(orders, eq(orders.id, orderReviews.orderId))
      .leftJoin(users, eq(users.id, orderReviews.userId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(orderReviews.createdAt))
      .limit(query.limit);

    return reply.send(
      success(
        rows.map((row) => ({
          id: row.id,
          rating: row.rating,
          comment: row.comment,
          is_hidden: row.isHidden,
          restaurant_id: row.restaurantId,
          restaurant_name: row.restaurantName,
          public_order_number: row.publicOrderNumber,
          author_name: row.authorName,
          created_at: row.createdAt.toISOString(),
        })),
        { request_id: request.requestId },
      ),
    );
  });

  /** Held comments and reported reviews, waiting on a decision. */
  app.get(
    '/api/v1/admin/review-queue',
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertAdminPermission(requirePrincipal(request), 'restaurant.read');
      const query = z
        .object({ limit: z.coerce.number().int().min(1).max(100).default(50) })
        .parse(request.query);
      return reply.send(
        success(await moderationQueue(ctx, query.limit), { request_id: request.requestId }),
      );
    },
  );

  app.post(
    '/api/v1/admin/review-queue/:reviewId/resolve',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'restaurant.read');
      const { reviewId } = z.object({ reviewId: uuidSchema }).parse(request.params);
      const body = z
        .object({ action: z.enum(['PUBLISH', 'HIDE']), reason: reasonSchema })
        .parse(request.body);

      const result = await resolveReview(ctx, {
        reviewId,
        action: body.action,
        moderatorId: principal.userId,
      });

      await writeAudit(ctx.db, {
        actorUserId: principal.userId,
        action: AUDIT_ACTIONS.REVIEW_REPORTS_RESOLVE,
        entityType: 'order_review',
        entityId: reviewId,
        after: { action: body.action, restaurantRating: result.average },
        reason: body.reason,
        ip: clientIp(request),
        userAgent: userAgent(request),
        requestId: request.requestId,
      });

      return reply.send(
        success(
          {
            action: body.action,
            restaurant_rating: result.average,
            note_ar:
              body.action === 'HIDE'
                ? 'أُخفي التقييم وأُغلقت البلاغات.'
                : 'نُشر التقييم وأُغلقت البلاغات.',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  app.post(
    '/api/v1/admin/reviews/:reviewId/visibility',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'restaurant.read');
      const { reviewId } = z.object({ reviewId: uuidSchema }).parse(request.params);
      const body = z.object({ hidden: z.boolean(), reason: reasonSchema }).parse(request.body);

      const result = await setReviewHidden(ctx, {
        reviewId,
        hidden: body.hidden,
        moderatorId: principal.userId,
      });

      await writeAudit(ctx.db, {
        actorUserId: principal.userId,
        action: body.hidden ? AUDIT_ACTIONS.REVIEW_HIDE : AUDIT_ACTIONS.REVIEW_RESTORE,
        entityType: 'order_review',
        entityId: reviewId,
        after: { hidden: body.hidden, restaurantRating: result.average },
        reason: body.reason,
        ip: clientIp(request),
        userAgent: userAgent(request),
        requestId: request.requestId,
      });

      return reply.send(
        success(
          {
            hidden: body.hidden,
            restaurant_rating: result.average,
            restaurant_rating_count: result.count,
            note_ar: body.hidden
              ? 'أُخفي التقييم وأُعيد حساب متوسط تقييم المطعم فوراً.'
              : 'أُعيد التقييم وأُعيد حساب المتوسط.',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );
}
