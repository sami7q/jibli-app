import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, ERROR_CODES, EVENT_TYPES, success } from '@jibli/contracts';
import { AUDIT_ACTIONS, enqueueOutboxEvent, writeAudit } from '@jibli/domain';
import { restaurants } from '@jibli/db';
import type { AppContext } from '../../lib/context.js';
import { clientIp, userAgent } from '../../lib/context.js';
import { restaurantScope } from './scope.js';
import { assertRestaurantPermission } from '@jibli/auth';
import { computeReadiness } from '../../services/readiness-service.js';
import { notifyAdmins } from '../../services/admin-notification-service.js';

/**
 * Going live, from the restaurant's side.
 *
 * Admin has had the readiness checklist since the beginning; the restaurant has
 * had none of it. It set up its menu, hours and drivers with no way to see what
 * was still missing and no way to say it was finished — and Admin had no queue,
 * only a list of restaurants with nothing to say which were waiting.
 *
 * These two routes are that conversation: the restaurant reads the same twelve
 * checks Admin reads, and submits when the blocking ones pass.
 */

export function registerRestaurantActivationRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** The same checklist Admin sees, for the caller's own restaurant. */
  app.get(
    '/api/v1/restaurant-portal/readiness',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'settings.read');

      const [restaurant] = await ctx.db
        .select({
          operationalStatus: restaurants.operationalStatus,
          requestedAt: restaurants.activationRequestedAt,
          note: restaurants.activationRequestNote,
        })
        .from(restaurants)
        .where(and(eq(restaurants.id, restaurantId), isNull(restaurants.deletedAt)))
        .limit(1);

      if (!restaurant) throw new AppError(ERROR_CODES.NOT_FOUND);

      const readiness = await computeReadiness(ctx, restaurantId);

      return reply.send(
        success(
          {
            ...readiness,
            operational_status: restaurant.operationalStatus,
            /*
             * Both returned so the portal can tell three states apart: not yet
             * asked, asked and waiting, already live. A single boolean would
             * make the middle one invisible.
             */
            activation_requested_at: restaurant.requestedAt?.toISOString() ?? null,
            activation_request_note: restaurant.note,
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /** Submit, or resubmit after fixing what was missing. */
  app.post(
    '/api/v1/restaurant-portal/activation-request',
    {
      preHandler: app.authenticate,
      // A queue entry is cheap; a queue nobody can clear is not.
      config: { rateLimit: { max: 6, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      // The same permission that governs the settings this request is about.
      assertRestaurantPermission(principal, restaurantId, 'settings.write');

      const body = z
        .object({ note: z.string().trim().max(500).optional() })
        .parse(request.body ?? {});

      const [restaurant] = await ctx.db
        .select({
          id: restaurants.id,
          displayName: restaurants.displayName,
          operationalStatus: restaurants.operationalStatus,
        })
        .from(restaurants)
        .where(and(eq(restaurants.id, restaurantId), isNull(restaurants.deletedAt)))
        .limit(1);

      if (!restaurant) throw new AppError(ERROR_CODES.NOT_FOUND);

      if (restaurant.operationalStatus === 'ACTIVE') {
        throw new AppError(ERROR_CODES.CONFLICT, {
          details: { reason: 'ALREADY_ACTIVE' },
          messageAr: 'المطعم مفعّل بالفعل',
        });
      }

      if (restaurant.operationalStatus === 'SUSPENDED') {
        /*
         * A suspension is a decision someone made about this restaurant, and
         * the way back is that conversation — not a queue entry that looks like
         * ordinary onboarding to whoever picks it up.
         */
        throw new AppError(ERROR_CODES.CONFLICT, {
          details: { reason: 'SUSPENDED' },
          messageAr: 'المطعم موقوف. تواصل مع إدارة جيبلي.',
        });
      }

      /*
       * Checked here and not only in the UI. The button is hidden until the
       * checklist passes, but the request is what creates work for a human, and
       * "the UI would not have let me" is not something the server can verify.
       */
      const readiness = await computeReadiness(ctx, restaurantId);
      if (!readiness.ready) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
          details: { reason: 'NOT_READY', blocking_failures: readiness.blocking_failures },
          messageAr: 'أكمل المتطلبات المتبقية قبل إرسال الطلب',
        });
      }

      const now = new Date();

      await ctx.db.transaction(async (tx) => {
        await tx
          .update(restaurants)
          .set({
            activationRequestedAt: now,
            activationRequestNote: body.note ?? null,
            updatedAt: now,
          })
          .where(eq(restaurants.id, restaurantId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.RESTAURANT_REQUEST_INFO,
          entityType: 'restaurant',
          entityId: restaurantId,
          after: { activationRequestedAt: now.toISOString(), note: body.note ?? null },
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });

        /*
         * The bell, in the same transaction as the request. A request that
         * rolls back must not leave a notification pointing at it.
         */
        await notifyAdmins(
          ctx,
          {
            kind: 'ACTIVATION_REQUESTED',
            severity: 'ATTENTION',
            titleAr: 'مطعم يطلب التفعيل',
            bodyAr: body.note ?? 'أكمل المطعم قائمة الجاهزية وينتظر المراجعة',
            linkPath: `/restaurants/${restaurantId}`,
            entityType: 'restaurant',
            entityId: restaurantId,
            restaurantId,
            // One entry per restaurant: asking twice is still one thing waiting.
            dedupeKey: `activation:${restaurantId}`,
          },
          tx,
        );

        /*
         * Through the outbox as well, for anything outside the portal: the
         * request is committed with the row that records it, and the worker is
         * what publishes. An event sent outside the transaction is one that can
         * arrive for a change that rolled back.
         */
        await enqueueOutboxEvent(tx, {
          eventType: EVENT_TYPES.RESTAURANT_ACTIVATION_REQUESTED,
          aggregateType: 'restaurant',
          aggregateId: restaurantId,
          requestId: request.requestId,
          payload: {
            restaurantId,
            displayName: restaurant.displayName,
            requestedBy: principal.userId,
            note: body.note ?? null,
          },
        });
      });

      return reply.send(
        success(
          {
            requested_at: now.toISOString(),
            note_ar:
              'وصل طلبك إلى إدارة جيبلي. ستراجع الفريق بياناتك ويفعّل المطعم، وستصلك النتيجة هنا.',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /** Withdraw, for a restaurant that asked too early. */
  app.delete(
    '/api/v1/restaurant-portal/activation-request',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'settings.write');

      await ctx.db
        .update(restaurants)
        .set({ activationRequestedAt: null, activationRequestNote: null, updatedAt: new Date() })
        .where(eq(restaurants.id, restaurantId));

      return reply.send(success({ withdrawn: true }, { request_id: request.requestId }));
    },
  );
}
