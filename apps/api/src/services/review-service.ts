import { and, avg, count, desc, eq, gt, isNull, lte } from 'drizzle-orm';
import { orderReviews, orders, restaurants, uuidv7, type DbExecutor } from '@jibli/db';
import { AppError, ERROR_CODES } from '@jibli/contracts';
import type { AppContext } from '../lib/context.js';
import { getConfig } from './config-service.js';

/**
 * Ratings.
 *
 * The `order_reviews` table has existed since the first migration and nothing
 * has ever written to it, so `restaurants.rating_average` has been null on
 * every restaurant since launch and the star column on three screens has shown
 * a dash. This is the code that fills it.
 *
 * Two rules shape everything here:
 *
 *   1. **Only a completed order can be rated, by the person who placed it.**
 *      A rating that is not attached to a purchase is a review site, and review
 *      sites get brigaded. One order, one rating, enforced by a unique index —
 *      not by checking first, which two taps on a slow connection defeat.
 *
 *   2. **Not immediately.** A rating taken at the doorstep measures the last
 *      thirty seconds. The delay is configurable and defaults to fifteen
 *      minutes: long enough that the food has been eaten, short enough that the
 *      meal is still the thing being judged.
 */

/** How long after delivery a customer may rate. Configurable; 15 minutes. */
const DEFAULT_REVIEW_DELAY_MINUTES = 15;

/**
 * And how long the window stays open, counted from delivery.
 *
 * Five days. A month was long enough that the prompt outlived the memory it
 * asks about — a rating given three weeks later is recalling a receipt, not a
 * meal, and the list of things still awaiting judgement only grew. Short
 * enough to be answerable, long enough to survive a busy week.
 *
 * Measured from `completedAt` rather than when the order was placed, which is
 * the same boundary either way to within an hour and the more defensible one:
 * the window is for the meal that arrived, so it starts when it arrived.
 */
const REVIEW_WINDOW_DAYS = 5;

export interface ReviewEligibility {
  readonly can_review: boolean;
  readonly already_reviewed: boolean;
  /** When the window opens. Null once it has. */
  readonly opens_at: string | null;
  readonly closes_at: string | null;
  readonly reason: 'READY' | 'TOO_EARLY' | 'TOO_LATE' | 'NOT_COMPLETED' | 'ALREADY_REVIEWED';
}

export async function reviewDelayMinutes(ctx: AppContext): Promise<number> {
  return getConfig(ctx, 'review_delay_minutes', DEFAULT_REVIEW_DELAY_MINUTES);
}

/**
 * Whether this customer may rate this order, and if not, why.
 *
 * Returns a reason rather than a boolean so the app can say "you can rate this
 * in 12 minutes" instead of hiding the button and leaving the customer to
 * wonder whether rating exists at all.
 */
export async function reviewEligibility(
  ctx: AppContext,
  params: { orderId: string; userId: string; now?: Date },
): Promise<ReviewEligibility> {
  const now = params.now ?? new Date();
  const delayMs = (await reviewDelayMinutes(ctx)) * 60 * 1000;

  const [row] = await ctx.db
    .select({
      status: orders.status,
      completedAt: orders.completedAt,
      userId: orders.userId,
      reviewId: orderReviews.id,
    })
    .from(orders)
    .leftJoin(orderReviews, eq(orderReviews.orderId, orders.id))
    .where(and(eq(orders.id, params.orderId), eq(orders.userId, params.userId)))
    .limit(1);

  if (!row) {
    throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'order' } });
  }

  if (row.reviewId) {
    return {
      can_review: false,
      already_reviewed: true,
      opens_at: null,
      closes_at: null,
      reason: 'ALREADY_REVIEWED',
    };
  }

  if (row.status !== 'COMPLETED' || !row.completedAt) {
    return {
      can_review: false,
      already_reviewed: false,
      opens_at: null,
      closes_at: null,
      reason: 'NOT_COMPLETED',
    };
  }

  const opensAt = new Date(row.completedAt.getTime() + delayMs);
  const closesAt = new Date(row.completedAt.getTime() + REVIEW_WINDOW_DAYS * 86_400_000);

  if (now < opensAt) {
    return {
      can_review: false,
      already_reviewed: false,
      opens_at: opensAt.toISOString(),
      closes_at: closesAt.toISOString(),
      reason: 'TOO_EARLY',
    };
  }

  if (now > closesAt) {
    return {
      can_review: false,
      already_reviewed: false,
      opens_at: opensAt.toISOString(),
      closes_at: closesAt.toISOString(),
      reason: 'TOO_LATE',
    };
  }

  return {
    can_review: true,
    already_reviewed: false,
    opens_at: opensAt.toISOString(),
    closes_at: closesAt.toISOString(),
    reason: 'READY',
  };
}

/**
 * Recompute a restaurant's rating from its visible reviews.
 *
 * Recomputed rather than incremented. An incremental average cannot be undone
 * when a review is hidden for abuse, and a moderator hiding one is exactly when
 * the number must move — so the cheap path is the wrong one. It is one indexed
 * aggregate over a table that grows with orders, not with time.
 */
export async function recomputeRating(
  executor: DbExecutor,
  restaurantId: string,
): Promise<{ average: number | null; count: number }> {
  const [stats] = await executor
    .select({
      average: avg(orderReviews.rating),
      total: count(orderReviews.id),
    })
    .from(orderReviews)
    .where(and(eq(orderReviews.restaurantId, restaurantId), eq(orderReviews.isHidden, false)));

  const total = Number(stats?.total ?? 0);
  // Rounded to one decimal: the extra digits are noise, and a stored 4.33333
  // renders differently in three places.
  const average =
    total === 0 || stats?.average === null || stats?.average === undefined
      ? null
      : Math.round(Number(stats.average) * 10) / 10;

  await executor
    .update(restaurants)
    .set({ ratingAverage: average, ratingCount: total, updatedAt: new Date() })
    .where(eq(restaurants.id, restaurantId));

  return { average, count: total };
}

/** Rate an order. Throws if the window is not open. */
export async function submitReview(
  ctx: AppContext,
  params: {
    orderId: string;
    userId: string;
    rating: number;
    comment?: string | null;
  },
): Promise<{ average: number | null; count: number }> {
  const eligibility = await reviewEligibility(ctx, {
    orderId: params.orderId,
    userId: params.userId,
  });

  if (!eligibility.can_review) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      details: { reason: eligibility.reason, opens_at: eligibility.opens_at },
      messageAr: REVIEW_REFUSALS[eligibility.reason],
    });
  }

  const [order] = await ctx.db
    .select({ restaurantId: orders.restaurantId })
    .from(orders)
    .where(eq(orders.id, params.orderId))
    .limit(1);

  if (!order) {
    throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'order' } });
  }

  return ctx.db.transaction(async (tx) => {
    /*
     * The unique index on order_id is the real guard, not the eligibility check
     * above: two taps on a slow connection both pass the check, and only one
     * can win here.
     */
    const inserted = await tx
      .insert(orderReviews)
      .values({
        id: uuidv7(),
        orderId: params.orderId,
        userId: params.userId,
        restaurantId: order.restaurantId,
        rating: params.rating,
        comment: params.comment?.trim() || null,
      })
      .onConflictDoNothing()
      .returning({ id: orderReviews.id });

    if (inserted.length === 0) {
      throw new AppError(ERROR_CODES.CONFLICT, {
        details: { reason: 'ALREADY_REVIEWED' },
        messageAr: REVIEW_REFUSALS.ALREADY_REVIEWED,
      });
    }

    return recomputeRating(tx, order.restaurantId);
  });
}

/** Hide or restore a review, and move the rating with it. */
export async function setReviewHidden(
  ctx: AppContext,
  params: { reviewId: string; hidden: boolean; moderatorId: string },
): Promise<{ restaurantId: string; average: number | null; count: number }> {
  return ctx.db.transaction(async (tx) => {
    const updated = await tx
      .update(orderReviews)
      .set({
        isHidden: params.hidden,
        moderatedBy: params.moderatorId,
      })
      .where(eq(orderReviews.id, params.reviewId))
      .returning({ restaurantId: orderReviews.restaurantId });

    const restaurantId = updated[0]?.restaurantId;
    if (!restaurantId) {
      throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'review' } });
    }

    const stats = await recomputeRating(tx, restaurantId);
    return { restaurantId, ...stats };
  });
}

/**
 * Orders this customer could rate but has not.
 *
 * The prompt in the app is built from this: an order that finished long enough
 * ago, inside the window, with no review yet.
 */
export async function pendingReviews(
  ctx: AppContext,
  userId: string,
  limit = 5,
): Promise<{ order_id: string; restaurant_name: string; completed_at: string }[]> {
  const delayMinutes = await reviewDelayMinutes(ctx);

  /*
   * The two boundaries computed here rather than in SQL. `make_interval` with
   * an interpolated number is the shape the raw-SQL tripwire bans, and a Date
   * compared through drizzle's own operator carries the column's type with it.
   */
  const now = Date.now();
  const readyBefore = new Date(now - delayMinutes * 60_000);
  const windowOpenedAfter = new Date(now - REVIEW_WINDOW_DAYS * 86_400_000);

  const rows = await ctx.db
    .select({
      orderId: orders.id,
      restaurantName: restaurants.displayName,
      completedAt: orders.completedAt,
    })
    .from(orders)
    .innerJoin(restaurants, eq(restaurants.id, orders.restaurantId))
    .leftJoin(orderReviews, eq(orderReviews.orderId, orders.id))
    .where(
      and(
        eq(orders.userId, userId),
        eq(orders.status, 'COMPLETED'),
        isNull(orderReviews.id),
        // Long enough ago to be worth judging, recent enough to be remembered.
        lte(orders.completedAt, readyBefore),
        gt(orders.completedAt, windowOpenedAfter),
      ),
    )
    .orderBy(desc(orders.completedAt))
    .limit(limit);

  return rows.map((row) => ({
    order_id: row.orderId,
    restaurant_name: row.restaurantName,
    completed_at: (row.completedAt as Date).toISOString(),
  }));
}

/** Why a rating was refused, in the customer's language. */
const REVIEW_REFUSALS: Record<ReviewEligibility['reason'], string> = {
  READY: '',
  TOO_EARLY: 'يمكنك التقييم بعد قليل من استلام الطلب.',
  TOO_LATE: 'انتهت مدة تقييم هذا الطلب.',
  NOT_COMPLETED: 'يمكن تقييم الطلبات المكتملة فقط.',
  ALREADY_REVIEWED: 'سبق أن قيّمت هذا الطلب.',
};
