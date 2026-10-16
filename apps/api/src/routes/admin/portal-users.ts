import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, ERROR_CODES, success } from '@jibli/contracts';
import { assertAdminPermission, generatePortalPassword, hashPassword } from '@jibli/auth';
import { reasonSchema, suggestUsername, usernameSchema, uuidSchema } from '@jibli/validation';
import { AUDIT_ACTIONS, writeAudit } from '@jibli/domain';
import {
  restaurantMembers,
  restaurants,
  userPlatformRoles,
  users,
  uuidv7,
  type Transaction,
} from '@jibli/db';
import { clientIp, userAgent, type AppContext } from '../../lib/context.js';
import { requirePrincipal } from '../../plugins/auth.js';
import { revokeSessionChain } from '../../services/session-service.js';

/**
 * These endpoints act on *restaurant portal* users, not platform staff. A
 * target that holds a platform role, or that is not an active member of any
 * restaurant, is refused — otherwise an Onboarding/Operations staffer could
 * reset or suspend a SUPER_ADMIN and take over the platform (ADMIN-6). A
 * platform staff account's own credentials are managed through the staff
 * endpoints (reserved to roles.manage), never here.
 */
async function assertRestaurantPortalTarget(tx: Transaction, userId: string): Promise<void> {
  const platformRoles = await tx
    .select({ role: userPlatformRoles.role })
    .from(userPlatformRoles)
    .where(and(eq(userPlatformRoles.userId, userId), isNull(userPlatformRoles.revokedAt)))
    .limit(1);

  if (platformRoles.length > 0) {
    throw new AppError(ERROR_CODES.FORBIDDEN, {
      details: { reason: 'TARGET_IS_PLATFORM_STAFF' },
      messageAr: 'لا يمكن تنفيذ هذا الإجراء على حساب موظف منصة.',
    });
  }

  const [membership] = await tx
    .select({ id: restaurantMembers.id })
    .from(restaurantMembers)
    .where(and(eq(restaurantMembers.userId, userId), eq(restaurantMembers.isActive, true)))
    .limit(1);

  if (!membership) {
    throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'portal_user' } });
  }
}

/**
 * Restaurant portal credentials, issued by Jibli staff (plan §69, §85, §1854).
 *
 * A restaurant cannot sign itself up: the account is created here by an
 * operator who has already approved it, and handed over out of band. The
 * password is generated rather than chosen because an operator inventing
 * passwords for fifty restaurants invents fifty variants of one.
 *
 * It is shown once, stored only as an Argon2id hash, and flagged
 * must_change_password — until the owner replaces it, whoever read it out
 * still knows it.
 */
export function registerAdminPortalUserRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Who can sign in to this restaurant's portal. */
  app.get(
    '/api/v1/admin/restaurants/:restaurantId/portal-users',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'restaurant.read');
      const { restaurantId } = z.object({ restaurantId: uuidSchema }).parse(request.params);

      const rows = await ctx.db
        .select({
          memberId: restaurantMembers.id,
          userId: users.id,
          username: users.username,
          fullName: users.fullName,
          role: restaurantMembers.role,
          isActive: restaurantMembers.isActive,
          mustChangePassword: users.mustChangePassword,
          mfaEnabled: sql<boolean>`(${users.mfaEnabledAt} IS NOT NULL)`,
          lockedUntil: users.lockedUntil,
          lastLoginAt: users.lastLoginAt,
          createdAt: restaurantMembers.createdAt,
        })
        .from(restaurantMembers)
        .innerJoin(users, eq(restaurantMembers.userId, users.id))
        .where(and(eq(restaurantMembers.restaurantId, restaurantId), isNull(users.deletedAt)))
        .orderBy(desc(restaurantMembers.createdAt));

      return reply.send(
        success(
          rows.map((row) => ({
            member_id: row.memberId,
            user_id: row.userId,
            username: row.username,
            full_name: row.fullName,
            role: row.role,
            is_active: row.isActive,
            must_change_password: row.mustChangePassword,
            mfa_enabled: row.mfaEnabled,
            // Surfaced so support can see why a sign-in is failing without
            // asking the restaurant to guess.
            locked_until: row.lockedUntil?.toISOString() ?? null,
            last_login_at: row.lastLoginAt?.toISOString() ?? null,
            created_at: row.createdAt.toISOString(),
          })),
          { request_id: request.requestId },
        ),
      );
    },
  );

  /** A username suggestion, so the operator is not inventing one. */
  app.get(
    '/api/v1/admin/restaurants/:restaurantId/portal-users/suggest',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'restaurant.read');
      const { restaurantId } = z.object({ restaurantId: uuidSchema }).parse(request.params);

      const [restaurant] = await ctx.db
        .select({ displayName: restaurants.displayName, partnerCode: restaurants.partnerCode })
        .from(restaurants)
        .where(eq(restaurants.id, restaurantId))
        .limit(1);

      if (!restaurant) {
        throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'restaurant' } });
      }

      const base = suggestUsername(restaurant.displayName, restaurant.partnerCode);

      /*
       * Walk to a free name rather than returning one that will be rejected on
       * submit. Bounded: after a few tries fall back to the partner code, which
       * is unique by construction.
       */
      let candidate = base;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const [taken] = await ctx.db
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.username}) = ${candidate}`)
          .limit(1);

        if (!taken) break;
        candidate = `${base}-${attempt + 2}`.slice(0, 32);
      }

      return reply.send(success({ username: candidate }, { request_id: request.requestId }));
    },
  );

  /**
   * Create a portal account for a restaurant.
   *
   * Creates the user and the OWNER membership together: an account with a
   * username but no membership can sign in and reach nothing, which looks like
   * a broken password to whoever tries it.
   */
  app.post(
    '/api/v1/admin/restaurants/:restaurantId/portal-users',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      // Creating a credential that can accept orders and read finance is a
      // restaurant-creation-level act, not a read.
      assertAdminPermission(principal, 'restaurant.create');

      const { restaurantId } = z.object({ restaurantId: uuidSchema }).parse(request.params);
      const body = z
        .object({
          username: usernameSchema,
          full_name: z.string().trim().min(3).max(80),
          role: z.enum(['OWNER', 'MANAGER']).default('OWNER'),
        })
        .parse(request.body);

      // The generator validates against the same policy before returning, so
      // there is nothing left to re-check here.
      const password = generatePortalPassword({ username: body.username });

      const passwordHash = await hashPassword(password);
      const userId = uuidv7();

      await ctx.db.transaction(async (tx) => {
        const [restaurant] = await tx
          .select({ id: restaurants.id, displayName: restaurants.displayName })
          .from(restaurants)
          .where(and(eq(restaurants.id, restaurantId), isNull(restaurants.deletedAt)))
          .limit(1);

        if (!restaurant) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'restaurant' } });
        }

        const [taken] = await tx
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.username}) = ${body.username}`)
          .limit(1);

        if (taken) {
          throw new AppError(ERROR_CODES.CONFLICT, {
            details: { reason: 'USERNAME_TAKEN', field: 'username' },
          });
        }

        await tx.insert(users).values({
          id: userId,
          username: body.username,
          // No phone: staff issue this before anyone at the restaurant has been
          // reached. The account carries a username instead, which the
          // users_has_identifier constraint accepts.
          phoneE164: null,
          fullName: body.full_name,
          passwordHash,
          mustChangePassword: true,
          passwordChangedAt: new Date(),
          /*
           * Deliberately NOT setting profile_completed_at.
           *
           * It is a customer-flow marker, and users_profile_geography_complete
           * requires a completed profile to carry a governorate and a city —
           * a discovery geography a portal account has no reason to hold. The
           * flag is only ever read when placing an order, which a portal
           * account never does (plan §11).
           */
          status: 'ACTIVE',
        });

        await tx.insert(restaurantMembers).values({
          id: uuidv7(),
          restaurantId,
          userId,
          role: body.role,
          invitedBy: principal.userId,
        });

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.PORTAL_USER_CREATE,
          entityType: 'restaurant',
          entityId: restaurantId,
          before: null,
          // The password never reaches the audit log in any form (plan §1512).
          after: { userId, username: body.username, role: body.role },
          reason: null,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });
      });

      return reply.status(201).send(
        success(
          {
            user_id: userId,
            username: body.username,
            /*
             * Returned exactly once. Nothing stores it in plaintext, so this
             * response is the only opportunity to read it.
             */
            password,
            note_ar:
              'انسخ كلمة المرور الآن — لن تظهر مرة أخرى. سيُطلب من المطعم تغييرها عند أول دخول.',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * Reset a portal password.
   *
   * The old password is not recoverable, so this is the path for "the owner
   * forgot it" as well as "we think it leaked". Every live session is revoked:
   * a reset that leaves the previous holder signed in has not achieved
   * anything.
   */
  app.post(
    '/api/v1/admin/portal-users/:userId/reset-password',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'restaurant.create');
      const { userId } = z.object({ userId: uuidSchema }).parse(request.params);
      const body = z.object({ reason: reasonSchema }).parse(request.body);

      const password = generatePortalPassword();
      const passwordHash = await hashPassword(password);

      await ctx.db.transaction(async (tx) => {
        const [target] = await tx
          .select({ id: users.id, username: users.username })
          .from(users)
          .where(and(eq(users.id, userId), isNull(users.deletedAt)))
          .for('update')
          .limit(1);

        if (!target?.username) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'portal_user' } });
        }

        await assertRestaurantPortalTarget(tx, userId);

        await tx
          .update(users)
          .set({
            passwordHash,
            mustChangePassword: true,
            passwordChangedAt: new Date(),
            // A reset also clears a lockout: support resetting the password is
            // the intended way out of one.
            failedLoginCount: 0,
            lockedUntil: null,
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: AUDIT_ACTIONS.PORTAL_USER_RESET_PASSWORD,
          entityType: 'user',
          entityId: userId,
          before: null,
          after: { username: target.username },
          reason: body.reason,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });
      });

      // Outside the transaction: revoking sessions is not something to roll
      // back if the audit write were to fail.
      await revokeSessionChain(ctx, userId, 'PASSWORD_RESET');

      return reply.send(
        success(
          {
            password,
            note_ar: 'أُنهيت كل الجلسات المفتوحة. انسخ كلمة المرور الآن — لن تظهر مرة أخرى.',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /** Suspend or restore portal access without deleting the account. */
  app.patch(
    '/api/v1/admin/portal-users/:userId',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      assertAdminPermission(principal, 'restaurant.suspend');
      const { userId } = z.object({ userId: uuidSchema }).parse(request.params);
      const body = z.object({ is_active: z.boolean(), reason: reasonSchema }).parse(request.body);

      await ctx.db.transaction(async (tx) => {
        const [target] = await tx
          .select({ id: users.id, username: users.username, status: users.status })
          .from(users)
          .where(and(eq(users.id, userId), isNull(users.deletedAt)))
          .for('update')
          .limit(1);

        if (!target?.username) {
          throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'portal_user' } });
        }

        await assertRestaurantPortalTarget(tx, userId);

        await tx
          .update(users)
          .set({
            status: body.is_active ? 'ACTIVE' : 'SUSPENDED',
            // Restoring access clears the lockout too; otherwise the account is
            // active and still refuses the correct password.
            ...(body.is_active ? { failedLoginCount: 0, lockedUntil: null } : {}),
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));

        await writeAudit(tx, {
          actorUserId: principal.userId,
          action: body.is_active
            ? AUDIT_ACTIONS.PORTAL_USER_REACTIVATE
            : AUDIT_ACTIONS.PORTAL_USER_SUSPEND,
          entityType: 'user',
          entityId: userId,
          before: { status: target.status },
          after: { status: body.is_active ? 'ACTIVE' : 'SUSPENDED' },
          reason: body.reason,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });
      });

      if (!body.is_active) {
        // Suspension has to end the sessions that are already open, or it only
        // takes effect the next time they sign in.
        await revokeSessionChain(ctx, userId, 'PORTAL_ACCESS_SUSPENDED');
      }

      return reply.send(success({ updated: true }, { request_id: request.requestId }));
    },
  );
}
