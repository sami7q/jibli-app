import { and, desc, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  AppError,
  COUPON_FUNDING_SOURCES,
  COUPON_TYPES,
  ERROR_CODES,
  success,
} from '@jibli/contracts';
import { assertAdminPermission } from '@jibli/auth';
import { reasonSchema, uuidSchema } from '@jibli/validation';
import { AUDIT_ACTIONS, writeAudit } from '@jibli/domain';
import {
  coupons,
  couponRedemptions,
  restaurants,
  users,
  uuidv7,
} from '@jibli/db';
import { clientIp, userAgent, type AppContext } from '../../lib/context.js';
import { requirePrincipal } from '../../plugins/auth.js';

/**
 * Coupons (plan §60).
 *
 * The field that matters most here is `funding_source`. It is not a label: it
 * decides whose money the discount comes out of, and therefore what the
 * commission is charged on.
 *
 *   PLATFORM    — Jibli absorbs it. The restaurant is paid, and commissioned,
 *                 on the full pre-discount value.
 *   RESTAURANT  — the restaurant absorbs it, so the commission base drops with
 *                 the discount.
 *   SHARED      — split by `restaurant_share_bps`.
 *
 * `calculateOrderTotals` in @jibli/money is the single implementation of that
 * rule; nothing here recomputes it. This module only manages the definitions,
 * and refuses edits that would silently restate money already charged.
 */

const codeSchema = z
  .string()
  .trim()
  .min(3)
  .max(24)
  // Uppercase ASCII only: a coupon is read off a screen and typed by hand, and
  // Arabic-Indic digits or mixed case turn that into a support call.
  .regex(/^[A-Z0-9-]+$/, 'الرمز يجب أن يتكون من أحرف إنجليزية كبيرة وأرقام وشرطة فقط');

const bodySchema = z
  .object({
    code: codeSchema,
    type: z.enum(COUPON_TYPES),
    /** Basis points for PERCENTAGE, whole IQD for FIXED_AMOUNT. */
    value: z.number().int().positive(),
    max_discount_iqd: z.number().int().min(0).optional(),
    minimum_order_iqd: z.number().int().min(0).default(0),
    funding_source: z.enum(COUPON_FUNDING_SOURCES),
    restaurant_share_bps: z.number().int().min(0).max(10_000).optional(),
    restaurant_id: uuidSchema.optional(),
    total_usage_limit: z.number().int().positive().optional(),
    per_user_usage_limit: z.number().int().positive().default(1),
    starts_at: z.string().datetime(),
    ends_at: z.string().datetime().optional(),
  })
  .superRefine((body, context) => {
    if (body.type === 'PERCENTAGE' && body.value > 10_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'نسبة الخصم لا يمكن أن تتجاوز 100% (10000 نقطة أساس)',
      });
    }

    // A shared coupon without a split is ambiguous about whose money it is,
    // and that ambiguity would land in a settlement statement.
    if (body.funding_source === 'SHARED' && body.restaurant_share_bps === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['restaurant_share_bps'],
        message: 'التمويل المشترك يتطلب تحديد حصة المطعم',
      });
    }

    if (body.funding_source !== 'SHARED' && body.restaurant_share_bps !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['restaurant_share_bps'],
        message: 'حصة المطعم تُحدَّد فقط عند التمويل المشترك',
      });
    }

    // A restaurant-funded coupon has to name the restaurant funding it.
    if (body.funding_source === 'RESTAURANT' && body.restaurant_id === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['restaurant_id'],
        message: 'الكوبون الممول من المطعم يجب أن يرتبط بمطعم محدد',
      });
    }

    if (body.ends_at && body.ends_at <= body.starts_at) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ends_at'],
        message: 'تاريخ الانتهاء يجب أن يكون بعد تاريخ البدء',
      });
    }
  });

export function registerAdminCouponRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/v1/admin/coupons', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    assertAdminPermission(principal, 'coupon.manage');

    const query = z
      .object({ status: z.enum(['active', 'scheduled', 'expired', 'disabled']).optional() })
      .parse(request.query);

    const now = new Date();
    const conditions = [];

    // "Active" is a computed state, not a column: a coupon is live when it is
    // enabled *and* inside its window. Storing it would need a job to keep it
    // true and would be wrong between runs.
    if (query.status === 'active') {
      conditions.push(
        eq(coupons.isActive, true),
        lte(coupons.startsAt, now),
        or(isNull(coupons.endsAt), gt(coupons.endsAt, now)),
      );
    } else if (query.status === 'scheduled') {
      conditions.push(eq(coupons.isActive, true), gt(coupons.startsAt, now));
    } else if (query.status === 'expired') {
      conditions.push(and(isNotNull(coupons.endsAt), lte(coupons.endsAt, now)));
    } else if (query.status === 'disabled') {
      conditions.push(eq(coupons.isActive, false));
    }

    const rows = await ctx.db
      .select({
        id: coupons.id,
        code: coupons.code,
        type: coupons.type,
        value: coupons.value,
        maxDiscountIqd: coupons.maxDiscountIqd,
        minimumOrderIqd: coupons.minimumOrderIqd,
        fundingSource: coupons.fundingSource,
        restaurantShareBps: coupons.restaurantShareBps,
        restaurantId: coupons.restaurantId,
        restaurantName: restaurants.displayName,
        totalUsageLimit: coupons.totalUsageLimit,
        perUserUsageLimit: coupons.perUserUsageLimit,
        usageCount: coupons.usageCount,
        startsAt: coupons.startsAt,
        endsAt: coupons.endsAt,
        isActive: coupons.isActive,
        discountGivenIqd: sql<number>`(
          SELECT COALESCE(SUM(${couponRedemptions.discountAppliedIqd}), 0)
          FROM ${couponRedemptions}
          WHERE ${couponRedemptions.couponId} = ${coupons.id}
        )`,
      })
      .from(coupons)
      .leftJoin(restaurants, eq(coupons.restaurantId, restaurants.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(coupons.createdAt))
      .limit(100);

    return reply.send(
      success(
        rows.map((row) => ({
          id: row.id,
          code: row.code,
          type: row.type,
          value: row.value,
          max_discount_iqd: row.maxDiscountIqd,
          minimum_order_iqd: row.minimumOrderIqd,
          funding_source: row.fundingSource,
          restaurant_share_bps: row.restaurantShareBps,
          restaurant_id: row.restaurantId,
          restaurant_name: row.restaurantName,
          total_usage_limit: row.totalUsageLimit,
          per_user_usage_limit: row.perUserUsageLimit,
          usage_count: row.usageCount,
          discount_given_iqd: Number(row.discountGivenIqd),
          starts_at: row.startsAt.toISOString(),
          ends_at: row.endsAt?.toISOString() ?? null,
          is_active: row.isActive,
          state: couponState(row, now),
        })),
        { request_id: request.requestId },
      ),
    );
  });

  app.post('/api/v1/admin/coupons', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    assertAdminPermission(principal, 'coupon.manage');
    const body = bodySchema.parse(request.body);

    const id = uuidv7();

    await ctx.db.transaction(async (tx) => {
      if (body.restaurant_id) {
        const [restaurant] = await tx
          .select({ id: restaurants.id })
          .from(restaurants)
          .where(and(eq(restaurants.id, body.restaurant_id), isNull(restaurants.deletedAt)))
          .limit(1);

        if (!restaurant) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'restaurant' } });
        }
      }

      await tx.insert(coupons).values({
        id,
        code: body.code,
        type: body.type,
        value: body.value,
        maxDiscountIqd: body.max_discount_iqd ?? null,
        minimumOrderIqd: body.minimum_order_iqd,
        fundingSource: body.funding_source,
        restaurantShareBps: body.restaurant_share_bps ?? null,
        restaurantId: body.restaurant_id ?? null,
        totalUsageLimit: body.total_usage_limit ?? null,
        perUserUsageLimit: body.per_user_usage_limit,
        startsAt: new Date(body.starts_at),
        endsAt: body.ends_at ? new Date(body.ends_at) : null,
        createdBy: principal.userId,
      });

      await writeAudit(tx, {
        actorUserId: principal.userId,
        action: AUDIT_ACTIONS.COUPON_CREATE,
        entityType: 'coupon',
        entityId: id,
        before: null,
        after: { code: body.code, fundingSource: body.funding_source, value: body.value },
        reason: null,
        ip: clientIp(request),
        userAgent: userAgent(request),
        requestId: request.requestId,
      });
    });

    return reply.status(201).send(success({ id }, { request_id: request.requestId }));
  });

  /**
   * Enable or disable a coupon.
   *
   * Deliberately the *only* mutation. Editing a live coupon's value or funding
   * source would change what a redemption meant after the fact — orders already
   * carry a snapshot of the discount and its funding, so the definition and the
   * history would disagree. Superseding a coupon means disabling it and issuing
   * a new code (plan §60).
   */
  app.patch(
    '/api/v1/admin/coupons/:couponId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'coupon.manage');
      const { couponId } = z.object({ couponId: uuidSchema }).parse(request.params);
      const body = z
        .object({ is_active: z.boolean(), reason: reasonSchema })
        .parse(request.body);

      await ctx.db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: coupons.id, code: coupons.code, isActive: coupons.isActive })
          .from(coupons)
          .where(eq(coupons.id, couponId))
          .for('update')
          .limit(1);

        if (!existing) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'coupon' } });
        }

        await tx
          .update(coupons)
          .set({ isActive: body.is_active, updatedAt: new Date() })
          .where(eq(coupons.id, couponId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.COUPON_UPDATE,
          entityType: 'coupon',
          entityId: couponId,
          before: { isActive: existing.isActive },
          after: { isActive: body.is_active },
          reason: body.reason,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });
      });

      return reply.send(success({ updated: true }, { request_id: request.requestId }));
    },
  );

  /** Who redeemed a coupon and what it cost — the audit a marketing spend needs. */
  app.get(
    '/api/v1/admin/coupons/:couponId/redemptions',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'coupon.manage');
      const { couponId } = z.object({ couponId: uuidSchema }).parse(request.params);

      const rows = await ctx.db
        .select({
          id: couponRedemptions.id,
          orderId: couponRedemptions.orderId,
          discountAppliedIqd: couponRedemptions.discountAppliedIqd,
          createdAt: couponRedemptions.createdAt,
          // Names only. A marketing report has no business reason to hold
          // customer phone numbers (plan §92).
          customerName: users.fullName,
        })
        .from(couponRedemptions)
        .leftJoin(users, eq(couponRedemptions.userId, users.id))
        .where(eq(couponRedemptions.couponId, couponId))
        .orderBy(desc(couponRedemptions.createdAt))
        .limit(100);

      return reply.send(
        success(
          rows.map((row) => ({
            id: row.id,
            order_id: row.orderId,
            discount_applied_iqd: row.discountAppliedIqd,
            customer_name: row.customerName,
            redeemed_at: row.createdAt.toISOString(),
          })),
          { request_id: request.requestId },
        ),
      );
    },
  );
}

/** Lifecycle state, derived rather than stored (see the list handler). */
function couponState(
  row: { isActive: boolean; startsAt: Date; endsAt: Date | null; usageCount: number; totalUsageLimit: number | null },
  now: Date,
): 'ACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'DISABLED' | 'EXHAUSTED' {
  if (!row.isActive) return 'DISABLED';
  if (row.totalUsageLimit !== null && row.usageCount >= row.totalUsageLimit) return 'EXHAUSTED';
  if (row.startsAt > now) return 'SCHEDULED';
  if (row.endsAt !== null && row.endsAt <= now) return 'EXPIRED';
  return 'ACTIVE';
}
