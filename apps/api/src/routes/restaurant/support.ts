import { and, desc, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, ERROR_CODES, success } from '@jibli/contracts';
import { uuidSchema } from '@jibli/validation';
import {
  restaurants,
  supportMessages,
  supportThreads,
  users,
  uuidv7,
} from '@jibli/db';
import type { AppContext } from '../../lib/context.js';
import { restaurantScope } from './scope.js';
import { notifyAdmins } from '../../services/admin-notification-service.js';

/**
 * The restaurant's line to Jibli.
 *
 * Before this, a restaurant with a problem phoned whoever they happened to
 * know. Nothing was recorded, nobody else could pick it up, and the same
 * question got a different answer twice.
 *
 * No permission gate beyond membership: every member of a restaurant can ask
 * for help, including the one whose shift is the reason the question exists.
 * Restricting support to owners is how a problem waits until morning.
 */

const TOPICS = ['ORDERS', 'MENU', 'FINANCE', 'ACCOUNT', 'TECHNICAL', 'OTHER'] as const;

const openSchema = z.object({
  subject: z.string().trim().min(3).max(140),
  topic: z.enum(TOPICS).default('OTHER'),
  priority: z.enum(['NORMAL', 'URGENT']).default('NORMAL'),
  message: z.string().trim().min(5).max(4000),
});

const replySchema = z.object({
  message: z.string().trim().min(1).max(4000),
});

/** Open threads a restaurant may have at once. */
const OPEN_THREAD_LIMIT = 10;

export function registerRestaurantSupportRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** This restaurant's conversations, newest activity first. */
  app.get(
    '/api/v1/restaurant-portal/support/threads',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { restaurantId } = restaurantScope(request);

      const rows = await ctx.db
        .select({
          id: supportThreads.id,
          subject: supportThreads.subject,
          topic: supportThreads.topic,
          status: supportThreads.status,
          priority: supportThreads.priority,
          lastMessageAt: supportThreads.lastMessageAt,
          lastMessageFrom: supportThreads.lastMessageFrom,
          createdAt: supportThreads.createdAt,
          messageCount: sql<number>`(
            SELECT COUNT(*) FROM ${supportMessages}
            WHERE ${supportMessages.threadId} = ${supportThreads.id}
          )`,
        })
        .from(supportThreads)
        .where(eq(supportThreads.restaurantId, restaurantId))
        .orderBy(desc(supportThreads.lastMessageAt))
        .limit(100);

      return reply.send(
        success(
          rows.map((row) => ({
            id: row.id,
            subject: row.subject,
            topic: row.topic,
            status: row.status,
            priority: row.priority,
            last_message_at: row.lastMessageAt.toISOString(),
            last_message_from: row.lastMessageFrom,
            // "Jibli replied and you have not answered" is the only state the
            // restaurant needs highlighted; everything else is history.
            awaiting_you: row.status === 'ANSWERED',
            message_count: Number(row.messageCount),
            created_at: row.createdAt.toISOString(),
          })),
          { request_id: request.requestId },
        ),
      );
    },
  );

  /** One conversation with its messages. */
  app.get(
    '/api/v1/restaurant-portal/support/threads/:threadId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { restaurantId } = restaurantScope(request);
      const { threadId } = z.object({ threadId: uuidSchema }).parse(request.params);

      const [thread] = await ctx.db
        .select()
        .from(supportThreads)
        .where(
          // Scoped to the caller's restaurant: a thread id is not a capability.
          and(eq(supportThreads.id, threadId), eq(supportThreads.restaurantId, restaurantId)),
        )
        .limit(1);

      if (!thread) {
        throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'support_thread' } });
      }

      const messages = await ctx.db
        .select()
        .from(supportMessages)
        .where(eq(supportMessages.threadId, threadId))
        .orderBy(supportMessages.createdAt);

      return reply.send(
        success(
          {
            id: thread.id,
            subject: thread.subject,
            topic: thread.topic,
            status: thread.status,
            priority: thread.priority,
            created_at: thread.createdAt.toISOString(),
            resolved_at: thread.resolvedAt?.toISOString() ?? null,
            messages: messages.map((message) => ({
              id: message.id,
              side: message.authorSide,
              author_name: message.authorNameSnapshot,
              body: message.body,
              created_at: message.createdAt.toISOString(),
            })),
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /** Start a conversation. */
  app.post(
    '/api/v1/restaurant-portal/support/threads',
    {
      preHandler: app.authenticate,
      // Support is a conversation, not a form to submit repeatedly.
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      const body = openSchema.parse(request.body);

      const [open] = await ctx.db
        .select({ value: sql<number>`COUNT(*)` })
        .from(supportThreads)
        .where(
          and(
            eq(supportThreads.restaurantId, restaurantId),
            ne(supportThreads.status, 'RESOLVED'),
          ),
        );

      /*
       * A cap, not a rate limit: ten unresolved conversations is not a
       * restaurant with ten problems, it is a restaurant that should be
       * replying in the thread it already opened.
       */
      if (Number(open?.value ?? 0) >= OPEN_THREAD_LIMIT) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
          details: { reason: 'TOO_MANY_OPEN_THREADS', limit: OPEN_THREAD_LIMIT },
          messageAr:
            'لديك محادثات مفتوحة كثيرة. أكمل في إحداها أو انتظر ردّنا قبل فتح محادثة جديدة.',
        });
      }

      const [author] = await ctx.db
        .select({ fullName: users.fullName, username: users.username })
        .from(users)
        .where(eq(users.id, principal.userId))
        .limit(1);

      const [restaurant] = await ctx.db
        .select({ displayName: restaurants.displayName })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

      const threadId = uuidv7();
      const now = new Date();

      await ctx.db.transaction(async (tx) => {
        await tx.insert(supportThreads).values({
          id: threadId,
          restaurantId,
          openedBy: principal.userId,
          subject: body.subject,
          topic: body.topic,
          priority: body.priority,
          status: 'OPEN',
          lastMessageAt: now,
          lastMessageFrom: 'RESTAURANT',
        });

        await tx.insert(supportMessages).values({
          id: uuidv7(),
          threadId,
          authorSide: 'RESTAURANT',
          authorUserId: principal.userId,
          authorNameSnapshot: author?.fullName ?? author?.username ?? 'مستخدم المطعم',
          body: body.message,
        });

        /*
         * In the same transaction as the thread: a bell entry pointing at a
         * thread that was rolled back is worse than no bell entry.
         */
        await notifyAdmins(
          ctx,
          {
            kind: 'SUPPORT_MESSAGE',
            severity: body.priority === 'URGENT' ? 'URGENT' : 'ATTENTION',
            titleAr: `رسالة دعم من ${restaurant?.displayName ?? 'مطعم'}`,
            bodyAr: body.subject,
            linkPath: `/support/${threadId}`,
            entityType: 'support_thread',
            entityId: threadId,
            restaurantId,
            dedupeKey: `support:${threadId}`,
          },
          tx,
        );
      });

      return reply.status(201).send(
        success(
          {
            id: threadId,
            note_ar: 'وصلت رسالتك إلى فريق جيبلي. سيصلك الرد في هذه المحادثة.',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /** Add to an existing conversation. */
  app.post(
    '/api/v1/restaurant-portal/support/threads/:threadId/messages',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      const { threadId } = z.object({ threadId: uuidSchema }).parse(request.params);
      const body = replySchema.parse(request.body);

      const [thread] = await ctx.db
        .select({ id: supportThreads.id, status: supportThreads.status })
        .from(supportThreads)
        .where(and(eq(supportThreads.id, threadId), eq(supportThreads.restaurantId, restaurantId)))
        .limit(1);

      if (!thread) {
        throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'support_thread' } });
      }

      const [author] = await ctx.db
        .select({ fullName: users.fullName, username: users.username })
        .from(users)
        .where(eq(users.id, principal.userId))
        .limit(1);

      const [restaurant] = await ctx.db
        .select({ displayName: restaurants.displayName })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

      const now = new Date();

      await ctx.db.transaction(async (tx) => {
        await tx.insert(supportMessages).values({
          id: uuidv7(),
          threadId,
          authorSide: 'RESTAURANT',
          authorUserId: principal.userId,
          authorNameSnapshot: author?.fullName ?? author?.username ?? 'مستخدم المطعم',
          body: body.message,
        });

        /*
         * Replying reopens a resolved thread. The alternative — refusing, or
         * silently appending to something nobody is watching — turns "it came
         * back" into a message Jibli never sees.
         */
        await tx
          .update(supportThreads)
          .set({
            status: 'OPEN',
            lastMessageAt: now,
            lastMessageFrom: 'RESTAURANT',
            updatedAt: now,
            resolvedAt: null,
            resolvedBy: null,
          })
          .where(eq(supportThreads.id, threadId));

        await notifyAdmins(
          ctx,
          {
            kind: 'SUPPORT_MESSAGE',
            severity: 'ATTENTION',
            titleAr: `رسالة دعم من ${restaurant?.displayName ?? 'مطعم'}`,
            bodyAr: body.message.slice(0, 140),
            linkPath: `/support/${threadId}`,
            entityType: 'support_thread',
            entityId: threadId,
            restaurantId,
            // Same key as the thread: four messages before anyone looks leave
            // one unread entry, and it returns to the top each time.
            dedupeKey: `support:${threadId}`,
          },
          tx,
        );
      });

      return reply.status(201).send(success({ sent: true }, { request_id: request.requestId }));
    },
  );
}
