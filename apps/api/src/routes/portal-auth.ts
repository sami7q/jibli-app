import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { AppError, ERROR_CODES, success } from '@jibli/contracts';
import { verifyPassword } from '@jibli/auth';
import { toE164Iraq } from '@jibli/validation';
import { restaurantMembers, users, userPlatformRoles } from '@jibli/db';
import { clientIp, userAgent, type AppContext } from '../lib/context.js';
import { issueSession, loadCapabilities } from '../services/session-service.js';
import { verifyTotpForUser } from './mfa.js';

/**
 * Password sign-in for portal users (plan §77, §1853).
 *
 * Customers and drivers authenticate by OTP and have no password at all. Admin
 * and restaurant staff sign in here, because a web portal cannot depend on an
 * SMS round trip for every session, and because the plan requires MFA on top of
 * a password for Super Admin and Finance Admin.
 *
 * The refresh token is set as an **HttpOnly cookie**, not returned in the body.
 * A token in the body would have to be stored by the page, and anything a page
 * can read, injected script can read too. The access token *is* returned, and
 * is held in memory only for the life of the tab (plan §80).
 */

const loginSchema = z.object({
  phone: z.string().min(6).max(24),
  password: z.string().min(1).max(256),
  /** Present on the second leg, once MFA has been challenged. */
  mfa_code: z.string().min(6).max(10).optional(),
});

/**
 * Set the refresh cookie.
 *
 * `sameSite: 'lax'` rather than 'strict': the portal and the API are separate
 * origins in production, and 'strict' would drop the cookie on the first
 * navigation into the portal. 'none' would be required for a true cross-site
 * POST, which is exactly what we do not want to allow.
 */
function setRefreshCookie(reply: FastifyReply, ctx: AppContext, token: string): void {
  void reply.setCookie(ctx.env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: ctx.env.APP_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ctx.env.REFRESH_TOKEN_TTL_SECONDS,
    ...(ctx.env.SESSION_COOKIE_DOMAIN ? { domain: ctx.env.SESSION_COOKIE_DOMAIN } : {}),
  });
}

export function clearRefreshCookie(reply: FastifyReply, ctx: AppContext): void {
  void reply.clearCookie(ctx.env.SESSION_COOKIE_NAME, {
    path: '/',
    ...(ctx.env.SESSION_COOKIE_DOMAIN ? { domain: ctx.env.SESSION_COOKIE_DOMAIN } : {}),
  });
}

export function registerPortalAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post(
    '/api/v1/auth/login',
    {
      // Tighter than the global limit: this endpoint guards every password in
      // the system, and the global allowance is sized for ordinary browsing.
      config: {
        rateLimit: { max: 10, timeWindow: '5 minutes' },
      },
    },
    async (request, reply) => {
      const body = loginSchema.parse(request.body);

      /*
       * Every failure below returns the same error and takes a comparable
       * amount of time. Distinguishing "no such user" from "wrong password"
       * turns this endpoint into a way to enumerate which phone numbers belong
       * to staff (plan §78).
       */
      const invalid = () =>
        new AppError(ERROR_CODES.INVALID_CREDENTIALS, { details: { reason: 'INVALID_LOGIN' } });

      let phoneE164: string;
      try {
        phoneE164 = toE164Iraq(body.phone);
      } catch {
        // A malformed number is still just "bad credentials" to the caller.
        throw invalid();
      }

      const [user] = await ctx.db
        .select({
          id: users.id,
          passwordHash: users.passwordHash,
          status: users.status,
          mfaEnabledAt: users.mfaEnabledAt,
        })
        .from(users)
        .where(and(eq(users.phoneE164, phoneE164), isNull(users.deletedAt)))
        .limit(1);

      /*
       * Verify against a dummy hash when the user does not exist or has no
       * password. Returning early would make "unknown number" measurably faster
       * than "wrong password", which is the timing oracle the uniform error
       * above is meant to close.
       */
      const digest = user?.passwordHash ?? DUMMY_ARGON2_HASH;
      const passwordOk = await verifyPassword(body.password, digest);

      if (!user || !user.passwordHash || !passwordOk) throw invalid();

      if (user.status !== 'ACTIVE') {
        throw new AppError(ERROR_CODES.ACCOUNT_SUSPENDED, {
          details: { status: user.status },
        });
      }

      // A portal login must land somewhere. Someone with neither a platform
      // role nor a restaurant membership has no portal to enter.
      const capabilities = await loadCapabilities(ctx, user.id);
      const hasPortalAccess =
        capabilities.platformRoles.length > 0 ||
        Object.keys(capabilities.restaurantRoles).length > 0;

      if (!hasPortalAccess) throw invalid();

      const mfaEnabled = user.mfaEnabledAt !== null;

      if (mfaEnabled) {
        if (!body.mfa_code) {
          /*
           * The password was correct; say so, and ask for the second factor.
           * This is not an enumeration leak: reaching here already required the
           * right password for this account.
           */
          return reply.status(200).send(
            success(
              { mfa_required: true, note_ar: 'أدخل رمز التحقق من تطبيق المصادقة.' },
              { request_id: request.requestId },
            ),
          );
        }

        // Throws on a wrong, reused or replayed code.
        await verifyTotpForUser(ctx, {
          userId: user.id,
          code: body.mfa_code,
          ip: clientIp(request),
          userAgent: userAgent(request),
        });
      }

      const session = await issueSession(ctx, {
        userId: user.id,
        userAgent: userAgent(request),
        ip: clientIp(request),
        // Only a completed challenge counts. A user without MFA gets a session
        // with no mfaAt, so every step-up-guarded action still refuses them.
        mfaVerified: mfaEnabled,
      });

      await ctx.db
        .update(users)
        .set({ lastLoginAt: new Date() })
        .where(eq(users.id, user.id));

      setRefreshCookie(reply, ctx, session.refreshToken);

      return reply.send(
        success(
          {
            access_token: session.accessToken,
            expires_in_seconds: session.expiresInSeconds,
            mfa_required: false,
            user: {
              id: user.id,
              platform_roles: capabilities.platformRoles,
              restaurant_ids: Object.keys(capabilities.restaurantRoles),
              mfa_enabled: mfaEnabled,
            },
            /* Where the browser should go. A user with both kinds of access is
             * sent to Admin, which is the more privileged surface. */
            portal: capabilities.platformRoles.length > 0 ? 'ADMIN' : 'RESTAURANT',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * Exchange the refresh cookie for a fresh access token.
   *
   * This is the web counterpart of `/auth/refresh`, which takes the token in
   * the body for the mobile client. Splitting them keeps the cookie path from
   * accepting a token an attacker supplies in a body.
   */
  app.post('/api/v1/auth/session/refresh', async (request, reply) => {
    const token = request.cookies[ctx.env.SESSION_COOKIE_NAME];

    if (!token) {
      throw new AppError(ERROR_CODES.UNAUTHENTICATED, {
        details: { reason: 'NO_SESSION_COOKIE' },
      });
    }

    const { refreshSession } = await import('../services/session-service.js');

    let session;
    try {
      session = await refreshSession(ctx, {
        refreshToken: token,
        userAgent: userAgent(request),
        ip: clientIp(request),
      });
    } catch (error) {
      // A rejected refresh means the cookie is spent, rotated or revoked.
      // Leaving it in place would make the portal retry with it forever.
      clearRefreshCookie(reply, ctx);
      throw error;
    }

    setRefreshCookie(reply, ctx, session.refreshToken);

    return reply.send(
      success(
        {
          access_token: session.accessToken,
          expires_in_seconds: session.expiresInSeconds,
        },
        { request_id: request.requestId },
      ),
    );
  });

  /** Sign out of the portal: revoke the session and drop the cookie. */
  app.post('/api/v1/auth/session/logout', async (request, reply) => {
    const token = request.cookies[ctx.env.SESSION_COOKIE_NAME];
    clearRefreshCookie(reply, ctx);

    if (token) {
      const { revokeSessionByRefreshToken } = await import('../services/session-service.js');
      // Best effort: the cookie is already cleared, so a failure here must not
      // leave the user looking signed in.
      await revokeSessionByRefreshToken(ctx, token).catch(() => undefined);
    }

    return reply.send(success({ logged_out: true }, { request_id: request.requestId }));
  });

  /**
   * Who is signed in, for the portal shell.
   *
   * Returns the display name and the memberships the shell needs, so the portal
   * does not have to call two endpoints before it can render a greeting.
   */
  app.get('/api/v1/auth/portal/me', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = request.principal;
    if (!principal) throw new AppError(ERROR_CODES.UNAUTHENTICATED);

    const capabilities = await loadCapabilities(ctx, principal.userId);

    const [membershipCount] = await ctx.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(restaurantMembers)
      .where(
        and(eq(restaurantMembers.userId, principal.userId), eq(restaurantMembers.isActive, true)),
      );

    const [platformRoleCount] = await ctx.db
      .select({ count: sql<number>`COUNT(*)` })
      .from(userPlatformRoles)
      .where(
        and(
          eq(userPlatformRoles.userId, principal.userId),
          isNull(userPlatformRoles.revokedAt),
        ),
      );

    return reply.send(
      success(
        {
          user_id: principal.userId,
          full_name: capabilities.fullName,
          platform_roles: capabilities.platformRoles,
          restaurant_roles: capabilities.restaurantRoles,
          restaurant_count: Number(membershipCount?.count ?? 0),
          platform_role_count: Number(platformRoleCount?.count ?? 0),
        },
        { request_id: request.requestId },
      ),
    );
  });
}

/**
 * A real Argon2id hash of a value nobody knows.
 *
 * Verified against when the account does not exist, so that path costs the same
 * as a genuine check. Without it, "unknown number" returns in microseconds and
 * "wrong password" in ~50ms, which is enough to enumerate staff numbers.
 */
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Vc0QqGZVXKD8mQJc0wYqzRUHtTXhF4pFfJFYPnxvHXk';
