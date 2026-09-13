import { and, count, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, ERROR_CODES, success } from '@jibli/contracts';
import { assertAdminPermission } from '@jibli/auth';
import { uuidSchema } from '@jibli/validation';
import { AUDIT_ACTIONS, writeAudit } from '@jibli/domain';
import {
  restaurants,
  supportMessages,
  supportThreads,
  users,
  uuidv7,
} from '@jibli/db';
import { clientIp, userAgent, type AppContext } from '../../lib/context.js';
import { requirePrincipal } from '../../plugins/auth.js';
import {
  listNotifications,
  markRead,
  unreadCount,
} from '../../services/admin-notification-service.js';

/**
 * Support from Jibli's side, and the bell.
 *
 * They live in one module because they are one job: something arrives, an
 * operator sees it, an operator answers it. Splitting the queue from the thing
 * that announces the queue produces two screens that disagree about what is
 * outstanding.
 *
 * Permission is `restaurant.read` rather than a new one. Support is reading and
 * answering restaurants, which is what that permission already describes; a
 * separate `support.*` family would be a role matrix nobody maintains.
 */

const STATUSES = ['OPEN', 'ANSWERED', 'RESOLVED'] as const;

export function registerAdminSupportRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** The queue. Oldest thing waiting on Jibli first. */
  app.get('/api/v1/admin/support/threads', { preHandler: app.authenticate }, async (request, reply) => {
    assertAdminPermission(requirePrincipal(request), 'restaurant.read');

    const query = z
      .object({
        status: z.enum(STATUSES).optional(),
        restaurant_id: uuidSchema.optional(),
        q: z.string().max(80).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);

    const conditions = [];
    if (query.status) conditions.push(eq(supportThreads.status, query.status));
    if (query.restaurant_id) conditions.push(eq(supportThreads.restaurantId, query.restaurant_id));
    if (query.q) {
      conditions.push(
        or(
          ilike(supportThreads.subject, `%${query.q}%`),
          ilike(restaurants.displayName, `%${query.q}%`),
        ) as never,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

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
        restaurantId: restaurants.id,
        restaurantName: restaurants.displayName,
        partnerCode: restaurants.partnerCode,
        messageCount: sql<number>`(
          SELECT COUNT(*) FROM ${supportMessages}
          WHERE ${supportMessages.threadId} = ${supportThreads.id}
        )`,
      })
      .from(supportThreads)
      .innerJoin(restaurants, eq(restaurants.id, supportThreads.restaurantId))
      .where(where)
      /*
       * Work order, not recency: a thread waiting on Jibli outranks one waiting
       * on the restaurant, urgent outranks normal, and within that the one that
       * has waited longest comes first. Sorting by last message would put the
       * thread nobody needs to answer at the top.
       */
      .orderBy(
        sql`CASE ${supportThreads.status}
              WHEN 'OPEN' THEN 0 WHEN 'ANSWERED' THEN 1 ELSE 2 END`,
        sql`CASE ${supportThreads.priority} WHEN 'URGENT' THEN 0 ELSE 1 END`,
        supportThreads.lastMessageAt,
      )
      .limit(query.limit);

    const [open] = await ctx.db
      .select({ value: count() })
      .from(supportThreads)
      .where(eq(supportThreads.status, 'OPEN'));

    return reply.send(
      success(
        rows.map((row) => ({
          id: row.id,
          subject: row.subject,
          topic: row.topic,
          status: row.status,
          priority: row.priority,
          restaurant_id: row.restaurantId,
          restaurant_name: row.restaurantName,
          partner_code: row.partnerCode,
          last_message_at: row.lastMessageAt.toISOString(),
          last_message_from: row.lastMessageFrom,
          awaiting_jibli: row.status === 'OPEN',
          message_count: Number(row.messageCount),
          created_at: row.createdAt.toISOString(),
        })),
        { request_id: request.requestId, total: open?.value ?? 0 },
      ),
    );
  });

  /** One conversation. */
  app.get(
    '/api/v1/admin/support/threads/:threadId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertAdminPermission(requirePrincipal(request), 'restaurant.read');
      const { threadId } = z.object({ threadId: uuidSchema }).parse(request.params);

      const [thread] = await ctx.db
        .select({
          thread: supportThreads,
          restaurantName: restaurants.displayName,
          partnerCode: restaurants.partnerCode,
        })
        .from(supportThreads)
        .innerJoin(restaurants, eq(restaurants.id, supportThreads.restaurantId))
        .where(eq(supportThreads.id, threadId))
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
            id: thread.thread.id,
            subject: thread.thread.subject,
            topic: thread.thread.topic,
            status: thread.thread.status,
            priority: thread.thread.priority,
            restaurant_id: thread.thread.restaurantId,
            restaurant_name: thread.restaurantName,
            partner_code: thread.partnerCode,
            created_at: thread.thread.createdAt.toISOString(),
            resolved_at: thread.thread.resolvedAt?.toISOString() ?? null,
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

  /** Answer. */
  app.post(
    '/api/v1/admin/support/threads/:threadId/messages',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'restaurant.read');
      const { threadId } = z.object({ threadId: uuidSchema }).parse(request.params);
      const body = z
        .object({
          message: z.string().trim().min(1).max(4000),
          /** Answering usually means it is dealt with; the operator decides. */
          resolve: z.boolean().default(false),
        })
        .parse(request.body);

      const [thread] = await ctx.db
        .select({ id: supportThreads.id })
        .from(supportThreads)
        .where(eq(supportThreads.id, threadId))
        .limit(1);

      if (!thread) {
        throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'support_thread' } });
      }

      const [author] = await ctx.db
        .select({ fullName: users.fullName, username: users.username })
        .from(users)
        .where(eq(users.id, principal.userId))
        .limit(1);

      const now = new Date();

      await ctx.db.transaction(async (tx) => {
        await tx.insert(supportMessages).values({
          id: uuidv7(),
          threadId,
          authorSide: 'JIBLI',
          authorUserId: principal.userId,
          authorNameSnapshot: author?.fullName ?? author?.username ?? 'فريق جيبلي',
          body: body.message,
        });

        await tx
          .update(supportThreads)
          .set({
            status: body.resolve ? 'RESOLVED' : 'ANSWERED',
            lastMessageAt: now,
            lastMessageFrom: 'JIBLI',
            updatedAt: now,
            resolvedAt: body.resolve ? now : null,
            resolvedBy: body.resolve ? principal.userId : null,
          })
          .where(eq(supportThreads.id, threadId));
      });

      return reply.status(201).send(success({ sent: true }, { request_id: request.requestId }));
    },
  );

  /** Close without answering — for a thread already handled on the phone. */
  app.post(
    '/api/v1/admin/support/threads/:threadId/resolve',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'restaurant.read');
      const { threadId } = z.object({ threadId: uuidSchema }).parse(request.params);
      const body = z.object({ reason: z.string().trim().max(500).optional() }).parse(
        request.body ?? {},
      );

      const now = new Date();
      const updated = await ctx.db
        .update(supportThreads)
        .set({
          status: 'RESOLVED',
          resolvedAt: now,
          resolvedBy: principal.userId,
          updatedAt: now,
        })
        .where(eq(supportThreads.id, threadId))
        .returning({ id: supportThreads.id, restaurantId: supportThreads.restaurantId });

      if (updated.length === 0) {
        throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'support_thread' } });
      }

      await writeAudit(ctx.db, {
        actorUserId: principal.userId,
        action: AUDIT_ACTIONS.SUPPORT_THREAD_RESOLVE,
        entityType: 'support_thread',
        entityId: threadId,
        after: { status: 'RESOLVED' },
        reason: body.reason ?? null,
        ip: clientIp(request),
        userAgent: userAgent(request),
        requestId: request.requestId,
      });

      return reply.send(success({ resolved: true }, { request_id: request.requestId }));
    },
  );

  // ── The bell ──────────────────────────────────────────────────────────────

  /**
   * Unread count alone.
   *
   * Its own endpoint because the header polls it every minute, and shipping the
   * full list on each poll to render one number would move a page of text per
   * operator per minute for no reason.
   */
  app.get(
    '/api/v1/admin/notifications/unread-count',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      return reply.send(
        success(
          { unread: await unreadCount(ctx, principal.userId) },
          { request_id: request.requestId },
        ),
      );
    },
  );

  app.get('/api/v1/admin/notifications', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(30),
        unread_only: z.coerce.boolean().default(false),
      })
      .parse(request.query);

    return reply.send(
      success(
        await listNotifications(ctx, principal.userId, {
          limit: query.limit,
          unreadOnly: query.unread_only,
        }),
        { request_id: request.requestId },
      ),
    );
  });

  app.post(
    '/api/v1/admin/notifications/read',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      const body = z
        .object({
          /** Omit to mark everything read. */
          notification_ids: z.array(uuidSchema).max(200).optional(),
        })
        .parse(request.body ?? {});

      const marked = await markRead(
        ctx,
        principal.userId,
        body.notification_ids ?? 'ALL',
      );

      return reply.send(success({ marked }, { request_id: request.requestId }));
    },
  );
}
