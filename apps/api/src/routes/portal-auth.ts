import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ERROR_CODES, success } from '@jibli/contracts';
import {
  ADMIN_PASSWORD_MIN_LENGTH,
  checkPasswordPolicy,
  hashPassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_PROBLEM_MESSAGES_AR,
  verifyPassword,
} from '@jibli/auth';
import { AUDIT_ACTIONS, writeAudit } from '@jibli/domain';
import { loginIdentifierSchema } from '@jibli/validation';
import {
  loginAttempts,
  restaurantMembers,
  users,
  userPlatformRoles,
  uuidv7,
} from '@jibli/db';
import { clientIp, userAgent, type AppContext } from '../lib/context.js';
import { issueSession, loadCapabilities, refreshSession, revokeSessionByRefreshToken, revokeSessionChain } from '../services/session-service.js';
import { requirePrincipal } from '../plugins/auth.js';
import { getConfig } from '../services/config-service.js';
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
  username: loginIdentifierSchema,
  password: z.string().min(1).max(256),
  /** Present on the second leg, once MFA has been challenged. */
  mfa_code: z.string().min(6).max(10).optional(),
  /**
   * «تذكرني». Defaults to true, which is what the portal did before it was
   * ever asked — so an older client that does not send the field is unchanged.
   */
  remember_me: z.boolean().default(true),
});

/**
 * Per-account lockout.
 *
 * The Redis limiter caps attempts per IP per minute, which stops a flood but
 * not a patient attacker rotating addresses against one known username. This
 * counter lives on the account row and survives a restart.
 *
 * The window is deliberately short: the goal is to make an online guessing
 * attack uneconomic, not to give anyone a way to lock a competitor out of
 * their own portal for a day by typing the wrong password six times.
 */
const MAX_FAILED_LOGINS = 6;
const LOCKOUT_MINUTES = 15;

/**
 * Set the refresh cookie.
 *
 * `sameSite: 'lax'` rather than 'strict': the portal and the API are separate
 * origins in production, and 'strict' would drop the cookie on the first
 * navigation into the portal. 'none' would be required for a true cross-site
 * POST, which is exactly what we do not want to allow.
 */
function setRefreshCookie(
  reply: FastifyReply,
  ctx: AppContext,
  token: string,
  /**
   * Whether «تذكرني» was ticked.
   *
   * Ticked, the cookie carries `maxAge` and survives closing the browser —
   * which is what it has always done, so an unchanged client behaves exactly
   * as before. Unticked, `maxAge` is omitted and the browser drops it on exit:
   * the portal is used from tills and shared kitchen terminals, where "stay
   * signed in" is the setting somebody needs to be able to say no to.
   */
  remember: boolean,
): void {
  void reply.setCookie(ctx.env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: ctx.env.APP_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    ...(remember ? { maxAge: ctx.env.REFRESH_TOKEN_TTL_SECONDS } : {}),
    ...(ctx.env.SESSION_COOKIE_DOMAIN ? { domain: ctx.env.SESSION_COOKIE_DOMAIN } : {}),
  });

  /*
   * A readable companion carrying only the choice, never the token.
   *
   * Rotation re-issues the cookie on every refresh, and that handler has no
   * idea what was ticked at sign-in — so without this, a session-only choice
   * would quietly become a thirty-day one at the first rotation. The flag is
   * not a secret: it says nothing except which of the two a person picked.
   */
  void reply.setCookie(REMEMBER_COOKIE, remember ? '1' : '0', {
    httpOnly: false,
    secure: ctx.env.APP_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    ...(remember ? { maxAge: ctx.env.REFRESH_TOKEN_TTL_SECONDS } : {}),
    ...(ctx.env.SESSION_COOKIE_DOMAIN ? { domain: ctx.env.SESSION_COOKIE_DOMAIN } : {}),
  });
}

/** Names the choice, not the session. Read on rotation to preserve it. */
const REMEMBER_COOKIE = 'jibli_remember';

/** What was ticked at sign-in. Defaults to remembering, as it always did. */
function wasRemembered(request: FastifyRequest): boolean {
  return request.cookies[REMEMBER_COOKIE] !== '0';
}

export function clearRefreshCookie(reply: FastifyReply, ctx: AppContext): void {
  for (const name of [ctx.env.SESSION_COOKIE_NAME, REMEMBER_COOKIE]) {
    void reply.clearCookie(name, {
      path: '/',
      ...(ctx.env.SESSION_COOKIE_DOMAIN ? { domain: ctx.env.SESSION_COOKIE_DOMAIN } : {}),
    });
  }
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
      const ip = clientIp(request);
      const agent = userAgent(request);

      /** Record the attempt and build the uniform error; the caller throws it. */
      const reject = async (reason: string, userId: string | null = null): Promise<AppError> => {
        await recordAttempt(ctx, {
          userId,
          identifier: body.username,
          succeeded: false,
          failureReason: reason,
          ip,
          userAgent: agent,
        });
        /*
         * The shared message for this code names the phone, because the mobile
         * app signs in with one. The portals sign in with a username, and a
         * failed portal login telling someone their *phone* is wrong is simply
         * false. Still deliberately ambiguous between the two fields: saying
         * which one was wrong confirms that an account exists.
         */
        return new AppError(ERROR_CODES.INVALID_CREDENTIALS, {
          details: { reason: 'INVALID_LOGIN' },
          messageAr: 'اسم المستخدم أو كلمة المرور غير صحيحة',
        });
      };

      const [user] = await ctx.db
        .select({
          id: users.id,
          username: users.username,
          passwordHash: users.passwordHash,
          status: users.status,
          mfaEnabledAt: users.mfaEnabledAt,
          mustChangePassword: users.mustChangePassword,
          failedLoginCount: users.failedLoginCount,
          lockedUntil: users.lockedUntil,
        })
        .from(users)
        // lower() matches the unique index, so a username typed in any case
        // resolves to the one account that owns it.
        .where(and(sql`lower(${users.username}) = ${body.username}`, isNull(users.deletedAt)))
        .limit(1);

      /*
       * A locked account is refused before the password is even checked, so a
       * lockout cannot be used as an oracle for whether the password was right.
       */
      if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        await recordAttempt(ctx, {
          userId: user.id,
          identifier: body.username,
          succeeded: false,
          failureReason: 'LOCKED',
          ip,
          userAgent: agent,
        });
        throw new AppError(ERROR_CODES.RATE_LIMITED, {
          details: {
            reason: 'ACCOUNT_LOCKED',
            retryAfterSeconds: Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000),
          },
        });
      }

      /*
       * Verify against a dummy hash when the account does not exist or has no
       * password. Returning early would make "unknown username" measurably
       * faster than "wrong password" — a timing oracle that undoes the uniform
       * error message (plan §78).
       */
      const digest = user?.passwordHash ?? DUMMY_ARGON2_HASH;
      const passwordOk = await verifyPassword(body.password, digest);

      if (!user || !user.passwordHash) throw await reject('UNKNOWN_USER');

      if (!passwordOk) {
        const failures = user.failedLoginCount + 1;
        const locked = failures >= MAX_FAILED_LOGINS;

        await ctx.db
          .update(users)
          .set({
            failedLoginCount: failures,
            lockedUntil: locked ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
          })
          .where(eq(users.id, user.id));

        throw await reject('INVALID_PASSWORD', user.id);
      }

      if (user.status !== 'ACTIVE') {
        await recordAttempt(ctx, {
          userId: user.id,
          identifier: body.username,
          succeeded: false,
          failureReason: 'ACCOUNT_NOT_ACTIVE',
          ip,
          userAgent: agent,
        });
        throw new AppError(ERROR_CODES.ACCOUNT_SUSPENDED, { details: { status: user.status } });
      }

      // A portal login must land somewhere. Someone with neither a platform
      // role nor a restaurant membership has no portal to enter.
      const capabilities = await loadCapabilities(ctx, user.id);
      const isPlatform = capabilities.platformRoles.length > 0;
      const restaurantIds = Object.keys(capabilities.restaurantRoles);

      if (!isPlatform && restaurantIds.length === 0) {
        throw await reject('NO_PORTAL_ACCESS', user.id);
      }

      const mfaEnabled = user.mfaEnabledAt !== null;

      if (mfaEnabled) {
        if (!body.mfa_code) {
          /*
           * The password was correct; say so, and ask for the second factor.
           * Not an enumeration leak: reaching here already required the right
           * password for this account.
           */
          return reply.status(200).send(
            success(
              { mfa_required: true, note_ar: 'أدخل رمز التحقق من تطبيق المصادقة.' },
              { request_id: request.requestId },
            ),
          );
        }

        try {
          // Throws on a wrong, reused or replayed code.
          await verifyTotpForUser(ctx, {
            userId: user.id,
            code: body.mfa_code,
            ip,
            userAgent: agent,
          });
        } catch (error) {
          await recordAttempt(ctx, {
            userId: user.id,
            identifier: body.username,
            succeeded: false,
            failureReason: 'MFA_FAILED',
            ip,
            userAgent: agent,
          });
          throw error;
        }
      }

      const session = await issueSession(ctx, {
        userId: user.id,
        userAgent: agent,
        ip,
        // Only a completed challenge counts. A user without MFA gets a session
        // with no mfaAt, so every step-up-guarded action still refuses them.
        mfaVerified: mfaEnabled,
      });

      // A successful sign-in clears the lockout counter. Leaving it would mean
      // five old typos plus one new one locks an account that just proved it
      // knows the password.
      await ctx.db
        .update(users)
        .set({ lastLoginAt: new Date(), failedLoginCount: 0, lockedUntil: null })
        .where(eq(users.id, user.id));

      await recordAttempt(ctx, {
        userId: user.id,
        identifier: body.username,
        succeeded: true,
        failureReason: null,
        ip,
        userAgent: agent,
      });

      setRefreshCookie(reply, ctx, session.refreshToken, body.remember_me);

      return reply.send(
        success(
          {
            access_token: session.accessToken,
            expires_in_seconds: session.expiresInSeconds,
            mfa_required: false,
            user: {
              id: user.id,
              username: user.username,
              platform_roles: capabilities.platformRoles,
              restaurant_ids: restaurantIds,
              mfa_enabled: mfaEnabled,
            },
            /*
             * A password someone else chose is a password someone else knows.
             * Staff issue the first one and read it out; until it is replaced
             * the account is effectively shared, so the portal routes straight
             * to the change form.
             */
            must_change_password: user.mustChangePassword,
            /*
             * Platform roles reach money and roles, so the plan makes MFA
             * mandatory for them (§88, §1853). Whether that is *enforced* is a
             * setting: on a one-person pilot a hard requirement locks the only
             * admin out of their own platform, and an account that cannot sign
             * in is not a more secure account. Sensitive actions still demand
             * a step-up either way — with an authenticator code when one is
             * enrolled, and the password when one is not.
             */
            mfa_enrolment_required:
              isPlatform && !mfaEnabled && (await getConfig(ctx, 'require_mfa', false)),
            /* Where the browser should go. A user with both kinds of access is
             * sent to Admin, which is the more privileged surface. */
            portal: isPlatform ? 'ADMIN' : 'RESTAURANT',
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

    setRefreshCookie(reply, ctx, session.refreshToken, wasRemembered(request));

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
      // Best effort: the cookie is already cleared, so a failure here must not
      // leave the user looking signed in.
      await revokeSessionByRefreshToken(ctx, token).catch(() => undefined);
    }

    return reply.send(success({ logged_out: true }, { request_id: request.requestId }));
  });

  /**
   * Change your own password.
   *
   * Requires the current one even though the session already proves identity:
   * an unattended open session should not be enough to lock the real owner out
   * of their own account.
   *
   * Every other session is revoked afterwards. If the reason for changing was
   * that someone else knew the password, leaving their session alive achieves
   * nothing.
   */
  app.post(
    '/api/v1/auth/password',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
    },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      const body = z
        .object({
          current_password: z.string().min(1).max(256),
          new_password: z.string().min(1).max(256),
        })
        .parse(request.body);

      const [user] = await ctx.db
        .select({
          id: users.id,
          username: users.username,
          passwordHash: users.passwordHash,
        })
        .from(users)
        .where(and(eq(users.id, principal.userId), isNull(users.deletedAt)))
        .limit(1);

      if (!user?.passwordHash) {
        throw new AppError(ERROR_CODES.FORBIDDEN, { details: { reason: 'NO_PASSWORD_SET' } });
      }

      if (!(await verifyPassword(body.current_password, user.passwordHash))) {
        /*
         * Named precisely, and safely: the caller is already authenticated, so
         * there is nothing left to leak by saying which field was wrong — and
         * this is the forced first-password-change screen, where a vague error
         * leaves someone stuck with no idea what to correct.
         */
        throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, {
          details: { reason: 'CURRENT_PASSWORD_WRONG' },
          messageAr: 'كلمة المرور الحالية غير صحيحة',
        });
      }

      /*
       * Platform staff are held to a longer minimum: their credential reaches
       * settlements, roles and every restaurant (plan §1853).
       */
      const isPlatformStaff = principal.platformRoles.length > 0;
      const policy = checkPasswordPolicy(body.new_password, {
        minLength: isPlatformStaff ? ADMIN_PASSWORD_MIN_LENGTH : PASSWORD_MIN_LENGTH,
        ...(user.username ? { username: user.username } : {}),
      });

      if (!policy.ok) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
          details: {
            field: 'new_password',
            problems: policy.problems,
            messages_ar: policy.problems.map(
              (problem) => PASSWORD_PROBLEM_MESSAGES_AR[problem] ?? problem,
            ),
          },
        });
      }

      // Reusing the password defeats the point of changing it.
      if (await verifyPassword(body.new_password, user.passwordHash)) {
        throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
          details: { field: 'new_password', problems: ['PASSWORD_UNCHANGED'] },
        });
      }

      await ctx.db
        .update(users)
        .set({
          passwordHash: await hashPassword(body.new_password),
          mustChangePassword: false,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id));

      await writeAudit(ctx.db, {
        actorUserId: user.id,
        action: AUDIT_ACTIONS.PASSWORD_CHANGE,
        entityType: 'user',
        entityId: user.id,
        before: null,
        after: { self: true },
        reason: null,
        ip: clientIp(request),
        userAgent: userAgent(request),
        requestId: request.requestId,
      });

      /*
       * Revoke everything, then issue a fresh session for this browser. The
       * alternative — keeping the current session alive — would mean the
       * session that existed under the old password survives the change.
       */
      await revokeSessionChain(ctx, user.id, 'PASSWORD_CHANGED');

      const session = await issueSession(ctx, {
        userId: user.id,
        userAgent: userAgent(request),
        ip: clientIp(request),
        mfaVerified: principal.mfaAt !== null,
      });

      setRefreshCookie(reply, ctx, session.refreshToken, wasRemembered(request));

      return reply.send(
        success(
          {
            changed: true,
            access_token: session.accessToken,
            expires_in_seconds: session.expiresInSeconds,
            note_ar: 'تم تغيير كلمة المرور، وأُنهيت كل الجلسات الأخرى.',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * Who is signed in, for the portal shell.
   *
   * Returns the display name and the memberships the shell needs, so the portal
   * does not have to call two endpoints before it can render a greeting.
   */
  app.get('/api/v1/auth/portal/me', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);

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
          /*
           * The change-password screen needs it: the policy refuses a password
           * containing the username, and it cannot check what it was never told.
           * The field was absent, so that rule silently never ran.
           */
          username: capabilities.username,
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
 * Write one row to the sign-in log.
 *
 * Never throws: telemetry must not be able to turn a successful login into a
 * 500, nor a failed one into a different error than the uniform message.
 */
async function recordAttempt(
  ctx: AppContext,
  params: {
    userId: string | null;
    identifier: string;
    succeeded: boolean;
    failureReason: string | null;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  try {
    await ctx.db.insert(loginAttempts).values({
      id: uuidv7(),
      userId: params.userId,
      identifier: params.identifier,
      succeeded: params.succeeded,
      failureReason: params.failureReason,
      ip: params.ip,
      userAgent: params.userAgent,
    });
  } catch (error) {
    ctx.logger.warn({ event: 'login_attempt.record_failed', err: error }, 'could not log attempt');
  }
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
