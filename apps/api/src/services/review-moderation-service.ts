import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { AppError, ERROR_CODES } from '@jibli/contracts';
import {
  adminNotifications,
  orderReviews,
  orders,
  restaurantMembers,
  restaurants,
  reviewReports,
  userBlocks,
  users,
  uuidv7,
  type DbExecutor,
  type ReviewReportReason,
} from '@jibli/db';
import type { AppContext } from '../lib/context.js';
import { notifyAdmins } from './admin-notification-service.js';
import { recomputeRating } from './review-service.js';

/**
 * What readers can do about a review, and what Admin does about what they did.
 *
 * Both stores ask the same of an app that publishes text one user writes for
 * others to read: a way to report it, a way to stop seeing its author, and
 * someone who acts on reports. A report goes to the queue; enough of them hide
 * the review before anyone looks, because three independent people objecting
 * is a signal worth acting on at 3 a.m. A block is personal: the blocker stops
 * seeing that author's reviews, and nobody else's view changes.
 *
 * Only independent reporters count toward hiding: never anyone who is or was
 * on the shop's staff (an owner, a manager and a cashier would otherwise bury
 * any bad review of their shop; membership is deactivated, never deleted, so
 * a former member still matches), and only people who have received at least
 * one order (DELIVERED or COMPLETED — not a cancelled or rejected one), so
 * three throwaway sign-ups cannot do it either. One report per person per
 * review is a unique index, so nobody counts twice. Reports that do not count
 * still reach the queue.
 */

/**
 * Everything a person wrote for others to read, gone with their account:
 * their reviews (and, by cascade, reports filed against them), the reports
 * they filed and blocks in either direction. Each shop they rated has its
 * average recomputed without their stars. Run inside the deletion transaction.
 *
 * The admin bell copies the first words of a low rating or a reported comment
 * into its body, keyed by the review's id or its order's id. Those entries go
 * too, or the comment the policy says is deleted would survive in the bell.
 */
export async function deleteUserContent(
  executor: DbExecutor,
  userId: string,
): Promise<{ reviews: number; restaurants: string[] }> {
  const reviewed = await executor
    .delete(orderReviews)
    .where(eq(orderReviews.userId, userId))
    .returning({
      id: orderReviews.id,
      orderId: orderReviews.orderId,
      restaurantId: orderReviews.restaurantId,
    });
  if (reviewed.length > 0) {
    await executor.delete(adminNotifications).where(
      and(
        eq(adminNotifications.entityType, 'order_review'),
        inArray(
          adminNotifications.entityId,
          reviewed.flatMap((row) => [row.id, row.orderId]),
        ),
      ),
    );
  }
  await executor.delete(reviewReports).where(eq(reviewReports.reporterUserId, userId));
  await executor
    .delete(userBlocks)
    .where(or(eq(userBlocks.blockerUserId, userId), eq(userBlocks.blockedUserId, userId)));

  const touched = [...new Set(reviewed.map((row) => row.restaurantId))];
  for (const restaurantId of touched) await recomputeRating(executor, restaurantId);
  return { reviews: reviewed.length, restaurants: touched };
}

/** Distinct reporters after which a review is hidden pending a moderator. */
export const AUTO_HIDE_REPORTS = 3;

export async function reportReview(
  ctx: AppContext,
  params: {
    reviewId: string;
    reporterUserId: string;
    reason: ReviewReportReason;
    note?: string | null;
  },
): Promise<{ reported: boolean; hidden: boolean }> {
  const [review] = await ctx.db
    .select({
      id: orderReviews.id,
      userId: orderReviews.userId,
      restaurantId: orderReviews.restaurantId,
      isHidden: orderReviews.isHidden,
      comment: orderReviews.comment,
      restaurantName: restaurants.displayName,
    })
    .from(orderReviews)
    .innerJoin(restaurants, eq(restaurants.id, orderReviews.restaurantId))
    .where(eq(orderReviews.id, params.reviewId))
    .limit(1);

  if (!review) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'review' } });
  if (review.userId === params.reporterUserId) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      details: { reason: 'OWN_REVIEW' },
      messageAr: 'لا يمكنك الإبلاغ عن تقييمك.',
    });
  }

  return ctx.db.transaction(async (tx) => {
    const inserted = await tx
      .insert(reviewReports)
      .values({
        id: uuidv7(),
        reviewId: review.id,
        reporterUserId: params.reporterUserId,
        reason: params.reason,
        note: params.note?.trim() || null,
      })
      .onConflictDoNothing()
      .returning({ id: reviewReports.id });

    const [open] = await tx
      .select({ total: sql<number>`COUNT(*)` })
      .from(reviewReports)
      .where(
        and(
          eq(reviewReports.reviewId, review.id),
          eq(reviewReports.status, 'OPEN'),
          sql`NOT EXISTS (
            SELECT 1 FROM ${restaurantMembers}
            WHERE ${restaurantMembers.userId} = ${reviewReports.reporterUserId}
              AND ${restaurantMembers.restaurantId} = ${review.restaurantId}
          )`,
          sql`EXISTS (
            SELECT 1 FROM ${orders}
            WHERE ${orders.userId} = ${reviewReports.reporterUserId}
              AND ${orders.status} IN ('DELIVERED', 'COMPLETED')
          )`,
        ),
      );

    let hidden = review.isHidden;
    if (!review.isHidden && Number(open?.total ?? 0) >= AUTO_HIDE_REPORTS) {
      await tx
        .update(orderReviews)
        .set({ isHidden: true, heldReason: 'REPORTED', moderatedAt: null })
        .where(eq(orderReviews.id, review.id));
      await recomputeRating(tx, review.restaurantId);
      hidden = true;
    }

    if (inserted.length > 0) {
      await notifyAdmins(
        ctx,
        {
          kind: 'REVIEW_POSTED',
          severity: hidden ? 'URGENT' : 'ATTENTION',
          titleAr: hidden
            ? `أُخفي تقييم تلقائياً بعد ${AUTO_HIDE_REPORTS} بلاغات — ${review.restaurantName}`
            : `بلاغ على تقييم — ${review.restaurantName}`,
          bodyAr: review.comment?.slice(0, 140) ?? null,
          linkPath: '/reviews?queue=1',
          entityType: 'order_review',
          entityId: review.id,
          restaurantId: review.restaurantId,
        },
        tx,
      );
    }

    return { reported: inserted.length > 0, hidden };
  });
}

/** Stop seeing a review's author. Identity is never revealed to the blocker. */
export async function blockReviewAuthor(
  ctx: AppContext,
  params: { reviewId: string; blockerUserId: string },
): Promise<{ blocked: boolean }> {
  const [review] = await ctx.db
    .select({ userId: orderReviews.userId })
    .from(orderReviews)
    .where(eq(orderReviews.id, params.reviewId))
    .limit(1);

  if (!review) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'review' } });
  if (review.userId === params.blockerUserId) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      details: { reason: 'SELF' },
      messageAr: 'لا يمكنك حظر نفسك.',
    });
  }

  await ctx.db
    .insert(userBlocks)
    .values({ id: uuidv7(), blockerUserId: params.blockerUserId, blockedUserId: review.userId })
    .onConflictDoNothing();

  return { blocked: true };
}

export async function listBlocks(
  ctx: AppContext,
  userId: string,
): Promise<{ id: string; name: string; created_at: string }[]> {
  const rows = await ctx.db
    .select({ id: userBlocks.id, fullName: users.fullName, createdAt: userBlocks.createdAt })
    .from(userBlocks)
    .leftJoin(users, eq(users.id, userBlocks.blockedUserId))
    .where(eq(userBlocks.blockerUserId, userId))
    .orderBy(desc(userBlocks.createdAt));

  return rows.map((row) => ({
    id: row.id,
    // First name only, as everywhere a review's author is shown.
    name: row.fullName?.trim().split(/\s+/)[0] || 'عميل',
    created_at: row.createdAt.toISOString(),
  }));
}

export async function unblock(
  ctx: AppContext,
  params: { blockId: string; userId: string },
): Promise<{ removed: boolean }> {
  const removed = await ctx.db
    .delete(userBlocks)
    .where(and(eq(userBlocks.id, params.blockId), eq(userBlocks.blockerUserId, params.userId)))
    .returning({ id: userBlocks.id });
  return { removed: removed.length > 0 };
}

/** The authors this person has blocked — a filter for any list of reviews they read. */
export async function blockedAuthorIds(ctx: AppContext, userId: string | null): Promise<string[]> {
  if (!userId) return [];
  const rows = await ctx.db
    .select({ id: userBlocks.blockedUserId })
    .from(userBlocks)
    .where(eq(userBlocks.blockerUserId, userId));
  return rows.map((row) => row.id);
}

export interface QueueItem {
  readonly review_id: string;
  readonly rating: number;
  readonly comment: string | null;
  readonly is_hidden: boolean;
  readonly held_reason: string | null;
  readonly restaurant_id: string;
  readonly restaurant_name: string;
  readonly public_order_number: string;
  readonly author_name: string | null;
  readonly created_at: string;
  readonly open_reports: number;
  readonly report_reasons: string[];
  readonly report_notes: string[];
}

/**
 * Everything waiting on a moderator: reviews the screen held, and reviews
 * with open reports. Oldest decision first is not the point here — the newest
 * is what a shop is reading right now — so newest first.
 */
export async function moderationQueue(ctx: AppContext, limit = 50): Promise<QueueItem[]> {
  const reported = ctx.db
    .select({ reviewId: reviewReports.reviewId })
    .from(reviewReports)
    .where(eq(reviewReports.status, 'OPEN'));

  const rows = await ctx.db
    .select({
      id: orderReviews.id,
      rating: orderReviews.rating,
      comment: orderReviews.comment,
      isHidden: orderReviews.isHidden,
      heldReason: orderReviews.heldReason,
      restaurantId: restaurants.id,
      restaurantName: restaurants.displayName,
      publicOrderNumber: orders.publicOrderNumber,
      authorName: users.fullName,
      createdAt: orderReviews.createdAt,
    })
    .from(orderReviews)
    .innerJoin(restaurants, eq(restaurants.id, orderReviews.restaurantId))
    .innerJoin(orders, eq(orders.id, orderReviews.orderId))
    .leftJoin(users, eq(users.id, orderReviews.userId))
    .where(
      or(
        and(isNotNull(orderReviews.heldReason), isNull(orderReviews.moderatedAt)),
        inArray(orderReviews.id, reported),
      ),
    )
    .orderBy(desc(orderReviews.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const reports = await ctx.db
    .select({
      reviewId: reviewReports.reviewId,
      reason: reviewReports.reason,
      note: reviewReports.note,
    })
    .from(reviewReports)
    .where(
      and(
        inArray(
          reviewReports.reviewId,
          rows.map((row) => row.id),
        ),
        eq(reviewReports.status, 'OPEN'),
      ),
    );

  return rows.map((row) => {
    const mine = reports.filter((report) => report.reviewId === row.id);
    return {
      review_id: row.id,
      rating: row.rating,
      comment: row.comment,
      is_hidden: row.isHidden,
      held_reason: row.heldReason,
      restaurant_id: row.restaurantId,
      restaurant_name: row.restaurantName,
      public_order_number: row.publicOrderNumber,
      author_name: row.authorName,
      created_at: row.createdAt.toISOString(),
      open_reports: mine.length,
      report_reasons: [...new Set(mine.map((report) => report.reason))],
      report_notes: mine
        .map((report) => report.note)
        .filter((note): note is string => Boolean(note)),
    };
  });
}

/**
 * A moderator's decision: publish (the screen or the reporters were wrong) or
 * hide. Either way the review leaves the queue and its open reports close.
 */
export async function resolveReview(
  ctx: AppContext,
  params: { reviewId: string; action: 'PUBLISH' | 'HIDE'; moderatorId: string },
): Promise<{ restaurantId: string; average: number | null; count: number }> {
  return ctx.db.transaction(async (tx) => {
    const now = new Date();
    const updated = await tx
      .update(orderReviews)
      .set({
        isHidden: params.action === 'HIDE',
        heldReason: null,
        moderatedBy: params.moderatorId,
        moderatedAt: now,
      })
      .where(eq(orderReviews.id, params.reviewId))
      .returning({ restaurantId: orderReviews.restaurantId });

    const restaurantId = updated[0]?.restaurantId;
    if (!restaurantId) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'review' } });

    await tx
      .update(reviewReports)
      .set({
        status: params.action === 'HIDE' ? 'ACTIONED' : 'DISMISSED',
        resolvedBy: params.moderatorId,
        resolvedAt: now,
      })
      .where(and(eq(reviewReports.reviewId, params.reviewId), eq(reviewReports.status, 'OPEN')));

    const stats = await recomputeRating(tx, restaurantId);
    return { restaurantId, ...stats };
  });
}
