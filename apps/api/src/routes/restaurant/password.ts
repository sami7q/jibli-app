import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, ERROR_CODES, success } from '@jibli/contracts';
import {
  assertRestaurantPermission,
  checkPasswordPolicy,
  hashPassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PROBLEM_MESSAGES_AR,
} from '@jibli/auth';
import { AUDIT_ACTIONS, writeAudit } from '@jibli/domain';
import { maskPhone } from '@jibli/validation';
import { restaurantBranches, restaurantMembers, users } from '@jibli/db';
import { otpCodeSchema } from '@jibli/validation';
import type { AppContext } from '../../lib/context.js';
import { clientIp, userAgent } from '../../lib/context.js';
import { consumeOtpChallenge, requestOtp } from '../../services/otp-service.js';
import { issueSession, revokeSessionChain } from '../../services/session-service.js';
import { restaurantScope } from './scope.js';

/**
 * A shop's password, changed by the shop — proved by the owner's phone.
 *
 * A portal account is issued by Jibli's staff with a password read out over
 * the phone. Until now the only ways to replace it were the portal's change
 * form, which wants the current password, and a reset by staff, which wants
 * a support call. Neither suits the person standing in the shop with the app:
 * the temporary password is on a scrap of paper, and the shop is theirs.
 *
 * What proves it is theirs is the owner's number — the one Admin recorded
 * when the shop was created, or the applicant's own when it applied from the
 * app. A code goes to that number, never to a number the caller types, so
 * anyone holding the account's session still needs the owner's phone in hand
 * to set a new password. The owner is the one who consents, every time.
 */

const challengeSchema = z.object({}).passthrough();

const changeSchema = z.object({
  code: otpCodeSchema,
  new_password: z.string().min(1).max(256),
});

/**
 * The number that speaks for the shop: an active OWNER member's, the oldest
 * first, and the branch's own number when no owner carries one.
 */
async function ownerPhoneFor(ctx: AppContext, restaurantId: string): Promise<string> {
  const [owner] = await ctx.db
    .select({ phone: users.phoneE164 })
    .from(restaurantMembers)
    .innerJoin(users, eq(restaurantMembers.userId, users.id))
    .where(
      and(
        eq(restaurantMembers.restaurantId, restaurantId),
        eq(restaurantMembers.role, 'OWNER'),
        eq(restaurantMembers.isActive, true),
        isNotNull(users.phoneE164),
        isNull(users.deletedAt),
      ),
    )
    .orderBy(asc(restaurantMembers.createdAt))
    .limit(1);

  if (owner?.phone) return owner.phone;

  const [branch] = await ctx.db
    .select({ phone: restaurantBranches.phone })
    .from(restaurantBranches)
    .where(
      and(eq(restaurantBranches.restaurantId, restaurantId), isNull(restaurantBranches.deletedAt)),
    )
    .limit(1);

  if (branch?.phone) return branch.phone;

  throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
    details: { reason: 'NO_OWNER_PHONE' },
    messageAr: 'لا يوجد رقم هاتف مسجّل لمالك المتجر. يضيفه فريق جيبلي من لوحة الإدارة أولاً.',
  });
}

export function registerRestaurantPasswordRoutes(app: FastifyInstance, ctx: AppContext): void {
  /** Send the code to the owner's number, and say where it went. */
  app.post(
    '/api/v1/restaurant-portal/password/challenge',
    {
      preHandler: app.authenticate,
      // The same allowance as a customer's forgotten password.
      config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'settings.read');
      challengeSchema.parse(request.body ?? {});

      const [account] = await ctx.db
        .select({ username: users.username })
        .from(users)
        .where(and(eq(users.id, principal.userId), isNull(users.deletedAt)))
        .limit(1);

      /*
       * A phone-only owner — one who signed in with a code, whose shop was
       * approved onto that account — has no password to change. Saying so is
       * better than sending a code that sets one nothing signs in with.
       */
      if (!account?.username) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
          details: { reason: 'NO_PORTAL_ACCOUNT' },
          messageAr: 'هذا الحساب يدخل برقم الهاتف وليس له اسم مستخدم وكلمة مرور.',
        });
      }

      const phone = await ownerPhoneFor(ctx, restaurantId);
      const result = await requestOtp(ctx, {
        phoneE164: phone,
        ip: clientIp(request),
        userAgent: userAgent(request),
        requestId: request.requestId,
        purpose: 'PORTAL_PASSWORD',
      });

      return reply.send(
        success(
          {
            phone_masked: maskPhone(phone),
            expires_in_seconds: result.expiresInSeconds,
            resend_after_seconds: result.resendAfterSeconds,
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * Set the new password, and start a fresh session for this device.
   *
   * Every other session is revoked, as any password change does here: the
   * temporary password was read out and written down, and whoever else has
   * it is exactly who this is for. This device continues on new tokens.
   */
  app.post(
    '/api/v1/restaurant-portal/password',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      const { principal, restaurantId } = restaurantScope(request);
      assertRestaurantPermission(principal, restaurantId, 'settings.read');
      const body = changeSchema.parse(request.body);

      const [account] = await ctx.db
        .select({ id: users.id, username: users.username, passwordHash: users.passwordHash })
        .from(users)
        .where(and(eq(users.id, principal.userId), isNull(users.deletedAt)))
        .limit(1);

      if (!account?.username) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
          details: { reason: 'NO_PORTAL_ACCOUNT' },
          messageAr: 'هذا الحساب يدخل برقم الهاتف وليس له اسم مستخدم وكلمة مرور.',
        });
      }

      const policy = checkPasswordPolicy(body.new_password, {
        minLength: PASSWORD_MIN_LENGTH,
        username: account.username,
      });
      if (!policy.ok) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
          details: { field: 'new_password', problems: policy.problems },
          messageAr: policy.problems
            .map((problem) => PASSWORD_PROBLEM_MESSAGES_AR[problem] ?? problem)
            .join('؛ '),
        });
      }

      const phone = await ownerPhoneFor(ctx, restaurantId);
      await consumeOtpChallenge(ctx, {
        phoneE164: phone,
        code: body.code,
        purpose: 'PORTAL_PASSWORD',
      });

      const now = new Date();
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            passwordHash: await hashPassword(body.new_password),
            mustChangePassword: false,
            passwordChangedAt: now,
            failedLoginCount: 0,
            lockedUntil: null,
            updatedAt: now,
          })
          .where(eq(users.id, account.id));

        await writeAudit(tx, {
          actorUserId: account.id,
          action: AUDIT_ACTIONS.PASSWORD_CHANGE,
          entityType: 'user',
          entityId: account.id,
          before: null,
          // Which shop's owner consented; never the number itself.
          after: { self: true, via: 'owner_phone_otp', restaurantId },
          reason: null,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
        });
      });

      await revokeSessionChain(ctx, account.id, 'PASSWORD_CHANGED');

      const session = await issueSession(ctx, {
        userId: account.id,
        userAgent: userAgent(request),
        ip: clientIp(request),
        mfaVerified: principal.mfaAt !== null,
      });

      ctx.logger.info(
        { event: 'portal.password_changed', userId: account.id, restaurantId },
        'Portal password changed from the app after owner-phone verification',
      );

      return reply.send(
        success(
          {
            changed: true,
            access_token: session.accessToken,
            refresh_token: session.refreshToken,
            expires_in_seconds: session.expiresInSeconds,
            note_ar: 'تم تغيير كلمة المرور، وأُنهيت كل الجلسات الأخرى.',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );
}
