import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, ERROR_CODES, success } from '@jibli/contracts';
import { iraqiPhoneSchema, otpCodeSchema } from '@jibli/validation';
import {
  CUSTOMER_PASSWORD_MIN_LENGTH,
  PASSWORD_PROBLEM_MESSAGES_AR,
  checkPasswordPolicy,
  hashPassword,
  verifyPassword,
} from '@jibli/auth';
import { clientIp, userAgent, type AppContext } from '../lib/context.js';
import { consumeOtpChallenge, requestOtp, verifyOtp } from '../services/otp-service.js';
import {
  DUMMY_ARGON2_HASH,
  assertNotLockedOut,
  recordLoginAttempt,
  registerFailedPassword,
} from '../services/credential-service.js';
import { verifyGoogleIdToken } from '../services/google-identity.js';
import {
  issueSession,
  loadCapabilities,
  refreshSession,
  revokeSession,
  revokeSessionChain,
} from '../services/session-service.js';
import { requirePrincipal } from '../plugins/auth.js';
import { checkAppVersion } from '../services/config-service.js';
import { and, eq, isNull } from 'drizzle-orm';
import { users, uuidv7 } from '@jibli/db';

/**
 * Authentication routes (plan §10, §77).
 *
 *   POST /api/v1/auth/otp/request
 *   POST /api/v1/auth/otp/verify
 *   POST /api/v1/auth/register
 *   POST /api/v1/auth/register/verify
 *   POST /api/v1/auth/password/login
 *   POST /api/v1/auth/password/forgot
 *   POST /api/v1/auth/password/reset
 *   POST /api/v1/auth/refresh
 *   POST /api/v1/auth/logout
 *   GET  /api/v1/auth/me
 */

const otpRequestSchema = z.object({
  phone: iraqiPhoneSchema,
});

const otpVerifySchema = z.object({
  phone: iraqiPhoneSchema,
  code: otpCodeSchema,
  deviceId: z.string().max(128).optional(),
});

const googleSchema = z.object({
  /** The ID token the device got from Google. Never an access token. */
  id_token: z.string().min(20).max(4096),
  deviceId: z.string().max(128).optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(512),
});

/*
 * Password sign-in for customers.
 *
 * The app signed in with a one-time code and nothing else. That is the stronger
 * mechanism and it is not going away — it remains the only way to prove a
 * number, and therefore the only way to reset a password — but it costs an SMS
 * for every sign-in and it fails whenever delivery does, which on Iraqi
 * networks is often enough to lose an order over.
 *
 * So a password becomes a second key to the same door, and the number remains
 * the lock: registration is not complete until a code proves the number, and a
 * forgotten password is recovered the same way.
 */

/** Long enough to be a name, short enough to fit a receipt. */
const displayNameSchema = z.string().trim().min(2).max(80);

/**
 * Bounded so a very long candidate cannot be used to make Argon2 do unbounded
 * work on an unauthenticated endpoint; the policy check does the rest.
 */
const passwordSchema = z.string().min(1).max(256);

const registerSchema = z.object({
  full_name: displayNameSchema,
  phone: iraqiPhoneSchema,
  password: passwordSchema,
});

const registerVerifySchema = z.object({
  full_name: displayNameSchema,
  phone: iraqiPhoneSchema,
  password: passwordSchema,
  code: otpCodeSchema,
  deviceId: z.string().max(128).optional(),
});

const passwordLoginSchema = z.object({
  phone: iraqiPhoneSchema,
  password: passwordSchema,
  deviceId: z.string().max(128).optional(),
});

const forgotPasswordSchema = z.object({
  phone: iraqiPhoneSchema,
});

const resetPasswordSchema = z.object({
  phone: iraqiPhoneSchema,
  code: otpCodeSchema,
  password: passwordSchema,
  deviceId: z.string().max(128).optional(),
});

/**
 * Reject a password the policy refuses, listing what is wrong in Arabic.
 *
 * All the problems at once rather than the first one: a form that reveals its
 * rules one failed attempt at a time is how somebody ends up trying six
 * passwords and picking the worst one that was accepted.
 */
function assertPasswordAcceptable(password: string): void {
  const result = checkPasswordPolicy(password, { minLength: CUSTOMER_PASSWORD_MIN_LENGTH });
  if (result.ok) return;

  throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
    details: { field: 'password', problems: result.problems },
    messageAr: result.problems
      .map((problem) => PASSWORD_PROBLEM_MESSAGES_AR[problem] ?? problem)
      .join('؛ '),
  });
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  /**
   * Request an OTP.
   *
   * The response is deliberately identical whether or not the number has an
   * account: revealing which numbers are registered is account enumeration
   * (plan §78 "no detailed account-existence leakage").
   */
  app.post('/api/v1/auth/otp/request', async (request, reply) => {
    const body = otpRequestSchema.parse(request.body);

    const result = await requestOtp(ctx, {
      phoneE164: body.phone,
      ip: clientIp(request),
      userAgent: userAgent(request),
      requestId: request.requestId,
    });

    return reply.send(
      success(
        {
          sent: true,
          resend_after_seconds: result.resendAfterSeconds,
          expires_in_seconds: result.expiresInSeconds,
          ...(result.devCode ? { dev_code: result.devCode } : {}),
        },
        { request_id: request.requestId },
      ),
    );
  });

  /**
   * Verify an OTP and open a session.
   *
   * The response carries `profile_completed` so the app knows whether to route
   * to the mandatory profile flow or straight to Home (plan §11).
   */
  app.post('/api/v1/auth/otp/verify', async (request, reply) => {
    const body = otpVerifySchema.parse(request.body);

    const verification = await verifyOtp(ctx, {
      phoneE164: body.phone,
      code: body.code,
      requestId: request.requestId,
    });

    const session = await issueSession(ctx, {
      userId: verification.userId,
      userAgent: userAgent(request),
      ip: clientIp(request),
      deviceId: body.deviceId ?? null,
    });

    const capabilities = await loadCapabilities(ctx, verification.userId);

    return reply.send(
      success(
        {
          access_token: session.accessToken,
          refresh_token: session.refreshToken,
          expires_in_seconds: session.expiresInSeconds,
          user: {
            id: verification.userId,
            is_new_user: verification.isNewUser,
            profile_completed: capabilities.profileCompleted,
            modes: capabilities.modes,
            driver_id: capabilities.driverId,
            platform_roles: capabilities.platformRoles,
            restaurant_ids: Object.keys(capabilities.restaurantRoles),
          },
          // The app routes here next: profile completion is mandatory (plan §11).
          next_step: capabilities.profileCompleted ? 'HOME' : 'COMPLETE_PROFILE',
        },
        { request_id: request.requestId },
      ),
    );
  });

  /** Rotate a refresh token. */
  app.post('/api/v1/auth/refresh', async (request, reply) => {
    const body = refreshSchema.parse(request.body);

    const session = await refreshSession(ctx, {
      refreshToken: body.refreshToken,
      userAgent: userAgent(request),
      ip: clientIp(request),
    });

    return reply.send(
      success(
        {
          access_token: session.accessToken,
          refresh_token: session.refreshToken,
          expires_in_seconds: session.expiresInSeconds,
        },
        { request_id: request.requestId },
      ),
    );
  });

  app.post(
    '/api/v1/auth/logout',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      await revokeSession(ctx, principal.sessionId, 'LOGOUT');
      return reply.send(success({ logged_out: true }, { request_id: request.requestId }));
    },
  );

  /** Current session state — what the app calls on cold start. */
  /**
   * Sign in with Google (plan §10, extended).
   *
   * Google proves who someone is. It does **not** prove a number a driver can
   * call, and an order needs one — so this issues a session and reports
   * `next_step: 'VERIFY_PHONE'` when the account has no verified phone yet.
   * Browsing works immediately; checkout does not, and `assertPhoneVerified`
   * on the ordering routes is what enforces that rather than the client's
   * good manners.
   *
   * Matching is on Google's subject id, never the email: a Google account can
   * change its address, and matching on one would hand an existing account to
   * whoever claims that address next.
   */
  // ── Password sign-in ──────────────────────────────────────────────────────

  /**
   * Begin registration: check the number is free, then send a code to it.
   *
   * **No account is created here**, and that is the whole design. Creating one
   * on submit would let anybody type a stranger's number and take it: the
   * unique index on `phone_e164` means the real owner could never register,
   * and when they signed in with a code they would land inside the squatter's
   * account — which still has the squatter's password on it.
   *
   * So the number is proved first. The name and password are sent again with
   * the code at `/register/verify`, which is where the account is actually
   * created. They are not stored in the meantime; there is nothing to leak.
   */
  app.post(
    '/api/v1/auth/register',
    { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const body = registerSchema.parse(request.body);

      // Before the SMS, so a weak password costs a message and a wait rather
      // than being refused at the end of the flow.
      assertPasswordAcceptable(body.password);

      /*
       * A taken number is refused, and this one *does* leak that the number is
       * registered — unavoidably, because the alternative is telling somebody
       * their account was created when it was not, then failing at the code
       * screen with nothing to say.
       *
       * The leak is bounded to "this number has an account", which the sign-in
       * screen would confirm anyway, and it is rate limited to five attempts
       * per ten minutes. Enumerating Iraqi mobile numbers through that gate is
       * not a practical attack.
       */
      const [taken] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.phoneE164, body.phone))
        .limit(1);

      if (taken) {
        throw new AppError(ERROR_CODES.CONFLICT, {
          details: { field: 'phone', reason: 'PHONE_ALREADY_REGISTERED' },
          messageAr: 'هذا الرقم مسجّل بالفعل. سجّل الدخول، أو استخدم «نسيت كلمة السر».',
        });
      }

      const result = await requestOtp(ctx, {
        phoneE164: body.phone,
        ip: clientIp(request),
        userAgent: userAgent(request),
        requestId: request.requestId,
        purpose: 'REGISTER',
      });

      return reply.send(
        success(
          {
            resend_after_seconds: result.resendAfterSeconds,
            expires_in_seconds: result.expiresInSeconds,
            ...(result.devCode ? { dev_code: result.devCode } : {}),
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * Finish registration: the code proves the number, and the account is made.
   *
   * The name and password arrive again here rather than having been kept from
   * the first call. Holding them server-side between two requests would mean
   * storing an unverified stranger's password somewhere, keyed by a number
   * they may not own — the device already has both, and it is the right place
   * for them until there is an account to attach them to.
   */
  app.post(
    '/api/v1/auth/register/verify',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (request, reply) => {
      const body = registerVerifySchema.parse(request.body);
      assertPasswordAcceptable(body.password);

      // Throws unless the code is live, unspent, and was issued to register.
      await consumeOtpChallenge(ctx, {
        phoneE164: body.phone,
        code: body.code,
        purpose: 'REGISTER',
      });

      /*
       * Re-checked after the code, not only before it.
       *
       * Between requesting the code and entering it, the same number could
       * have completed a registration in another tab or signed in with a
       * one-time code. The unique index would refuse the insert below anyway;
       * this turns that into a sentence the customer can act on.
       */
      const [taken] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.phoneE164, body.phone))
        .limit(1);

      if (taken) {
        throw new AppError(ERROR_CODES.CONFLICT, {
          details: { field: 'phone', reason: 'PHONE_ALREADY_REGISTERED' },
          messageAr: 'هذا الرقم مسجّل بالفعل. سجّل الدخول، أو استخدم «نسيت كلمة السر».',
        });
      }

      const now = new Date();
      const userId = uuidv7();

      await ctx.db.insert(users).values({
        id: userId,
        fullName: body.full_name,
        phoneE164: body.phone,
        // The code is what proves it, so it is verified from the first moment —
        // unlike a Google sign-in, which has an identity but no number.
        phoneVerifiedAt: now,
        passwordHash: await hashPassword(body.password),
        lastLoginAt: now,
        status: 'ACTIVE',
      });

      ctx.logger.info(
        { event: 'user.registered', userId, requestId: request.requestId },
        'New customer registered with a password',
      );

      const session = await issueSession(ctx, {
        userId,
        userAgent: userAgent(request),
        ip: clientIp(request),
        deviceId: body.deviceId ?? null,
      });

      const capabilities = await loadCapabilities(ctx, userId);

      return reply.send(
        success(
          {
            access_token: session.accessToken,
            refresh_token: session.refreshToken,
            expires_in_seconds: session.expiresInSeconds,
            user: {
              id: userId,
              is_new_user: true,
              profile_completed: capabilities.profileCompleted,
              modes: capabilities.modes,
              driver_id: capabilities.driverId,
              platform_roles: capabilities.platformRoles,
              restaurant_ids: Object.keys(capabilities.restaurantRoles),
            },
            /*
             * A name is not a complete profile: an order also needs a
             * governorate and a city (plan §11), which registration does not
             * ask for. So this is nearly always COMPLETE_PROFILE, and the
             * screen it opens is shorter than it was because the name is done.
             */
            next_step: capabilities.profileCompleted ? 'HOME' : 'COMPLETE_PROFILE',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * Sign in with a number and a password.
   *
   * Deliberately the same shape as the portal's username login, down to the
   * shared lockout and the shared dummy hash — the two differ only in which
   * column identifies the account, and every property that makes the portal one
   * safe has to hold here too.
   */
  app.post(
    '/api/v1/auth/password/login',
    {
      // Tighter than the global limit: this endpoint guards every customer
      // password in the system.
      config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    },
    async (request, reply) => {
      const body = passwordLoginSchema.parse(request.body);
      const ip = clientIp(request);
      const agent = userAgent(request);

      /**
       * One message for every failure.
       *
       * "No account" and "wrong password" must be indistinguishable, or the
       * screen becomes a way to ask which Iraqi numbers are customers.
       */
      const reject = async (reason: string, userId: string | null = null): Promise<AppError> => {
        await recordLoginAttempt(ctx, {
          userId,
          identifier: body.phone,
          succeeded: false,
          failureReason: reason,
          ip,
          userAgent: agent,
        });
        return new AppError(ERROR_CODES.INVALID_CREDENTIALS, {
          details: { reason: 'INVALID_LOGIN' },
          messageAr: 'رقم الهاتف أو كلمة السر غير صحيحة',
        });
      };

      const [user] = await ctx.db
        .select({
          id: users.id,
          passwordHash: users.passwordHash,
          status: users.status,
          failedLoginCount: users.failedLoginCount,
          lockedUntil: users.lockedUntil,
        })
        .from(users)
        .where(and(eq(users.phoneE164, body.phone), isNull(users.deletedAt)))
        .limit(1);

      // Before the password is checked, so the lock cannot answer differently
      // for a right password than for a wrong one.
      await assertNotLockedOut(ctx, user, { identifier: body.phone, ip, userAgent: agent });

      /*
       * Verified against a dummy hash when there is no account, and when there
       * is one that has never set a password — a customer who has only ever
       * used one-time codes. Both must cost the same as a real check.
       */
      const digest = user?.passwordHash ?? DUMMY_ARGON2_HASH;
      const passwordOk = await verifyPassword(body.password, digest);

      if (!user) throw await reject('UNKNOWN_PHONE');

      /*
       * An account with no password is not an error the customer can be told
       * about — saying "this number has no password" confirms the number is
       * registered. They use a one-time code, or «نسيت كلمة السر», which sets
       * one. Both are offered on the same screen.
       */
      if (!user.passwordHash) throw await reject('NO_PASSWORD_SET', user.id);

      if (!passwordOk) {
        await registerFailedPassword(ctx, user);
        throw await reject('INVALID_PASSWORD', user.id);
      }

      if (user.status !== 'ACTIVE') throw new AppError(ERROR_CODES.ACCOUNT_SUSPENDED);

      const now = new Date();
      await ctx.db
        .update(users)
        // A correct password clears the budget, so six wrong attempts spread
        // over months never add up to a lockout.
        .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, updatedAt: now })
        .where(eq(users.id, user.id));

      await recordLoginAttempt(ctx, {
        userId: user.id,
        identifier: body.phone,
        succeeded: true,
        failureReason: null,
        ip,
        userAgent: agent,
      });

      const session = await issueSession(ctx, {
        userId: user.id,
        userAgent: agent,
        ip,
        deviceId: body.deviceId ?? null,
      });

      const capabilities = await loadCapabilities(ctx, user.id);

      return reply.send(
        success(
          {
            access_token: session.accessToken,
            refresh_token: session.refreshToken,
            expires_in_seconds: session.expiresInSeconds,
            user: {
              id: user.id,
              is_new_user: false,
              profile_completed: capabilities.profileCompleted,
              modes: capabilities.modes,
              driver_id: capabilities.driverId,
              platform_roles: capabilities.platformRoles,
              restaurant_ids: Object.keys(capabilities.restaurantRoles),
            },
            next_step: capabilities.profileCompleted ? 'HOME' : 'COMPLETE_PROFILE',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * Start a password reset.
   *
   * Answers the same way whether or not the number has an account — the one
   * place in this file where that rule costs something, because a customer who
   * mistypes their number waits for an SMS that was never sent. The alternative
   * is a public endpoint that reports which numbers are registered, which is
   * worse: it is the first step of every credential-stuffing campaign.
   */
  app.post(
    '/api/v1/auth/password/forgot',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const body = forgotPasswordSchema.parse(request.body);

      const [user] = await ctx.db
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(and(eq(users.phoneE164, body.phone), isNull(users.deletedAt)))
        .limit(1);

      /*
       * A suspended account is treated as absent rather than refused, so the
       * endpoint cannot be used to discover that a number was suspended.
       */
      if (user && user.status === 'ACTIVE') {
        await requestOtp(ctx, {
          phoneE164: body.phone,
          ip: clientIp(request),
          userAgent: userAgent(request),
          requestId: request.requestId,
          purpose: 'PASSWORD_RESET',
        });
      } else {
        ctx.logger.info(
          { event: 'password.forgot_unknown_phone', requestId: request.requestId },
          'Password reset requested for a number with no active account',
        );
      }

      /*
       * A fixed shape, not the real one. Returning `resendAfterSeconds` from
       * the OTP service would differ between a number that got a code and one
       * that did not, and that difference is the leak this endpoint avoids.
       */
      return reply.send(
        success(
          { sent: true, expires_in_seconds: ctx.env.OTP_TTL_SECONDS },
          { request_id: request.requestId },
        ),
      );
    },
  );

  /**
   * Finish a password reset, and sign the customer in.
   *
   * Every other session is revoked first. A reset is what somebody does when
   * they believe their account is not theirs alone any more, and leaving the
   * other sessions alive would make it a password change that locks nobody out.
   */
  app.post(
    '/api/v1/auth/password/reset',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const body = resetPasswordSchema.parse(request.body);
      assertPasswordAcceptable(body.password);

      await consumeOtpChallenge(ctx, {
        phoneE164: body.phone,
        code: body.code,
        purpose: 'PASSWORD_RESET',
      });

      const [user] = await ctx.db
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(and(eq(users.phoneE164, body.phone), isNull(users.deletedAt)))
        .limit(1);

      // The code was issued for an active account, so this is a race — the
      // account was deleted or suspended while the SMS was in flight.
      if (!user || user.status !== 'ACTIVE') {
        throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, {
          details: { reason: 'INVALID_LOGIN' },
          messageAr: 'تعذّر تغيير كلمة السر. حاول من جديد.',
        });
      }

      const now = new Date();
      await ctx.db
        .update(users)
        .set({
          passwordHash: await hashPassword(body.password),
          // A reset is also the way out of a lockout: somebody who has proved
          // the number should not have to wait fifteen minutes as well.
          failedLoginCount: 0,
          lockedUntil: null,
          // The code proved the number, so this is the moment it is verified —
          // which matters for an account created by Google that never had one.
          phoneVerifiedAt: now,
          lastLoginAt: now,
          updatedAt: now,
        })
        .where(eq(users.id, user.id));

      await revokeSessionChain(ctx, user.id, 'PASSWORD_RESET');

      ctx.logger.info(
        { event: 'password.reset', userId: user.id, requestId: request.requestId },
        'Password reset and all sessions revoked',
      );

      const session = await issueSession(ctx, {
        userId: user.id,
        userAgent: userAgent(request),
        ip: clientIp(request),
        deviceId: body.deviceId ?? null,
      });

      const capabilities = await loadCapabilities(ctx, user.id);

      return reply.send(
        success(
          {
            access_token: session.accessToken,
            refresh_token: session.refreshToken,
            expires_in_seconds: session.expiresInSeconds,
            user: {
              id: user.id,
              is_new_user: false,
              profile_completed: capabilities.profileCompleted,
              modes: capabilities.modes,
              driver_id: capabilities.driverId,
              platform_roles: capabilities.platformRoles,
              restaurant_ids: Object.keys(capabilities.restaurantRoles),
            },
            next_step: capabilities.profileCompleted ? 'HOME' : 'COMPLETE_PROFILE',
          },
          { request_id: request.requestId },
        ),
      );
    },
  );

  app.post('/api/v1/auth/google', async (request, reply) => {
    const body = googleSchema.parse(request.body);

    const audiences = (ctx.env.GOOGLE_CLIENT_IDS ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    const identity = await verifyGoogleIdToken(body.id_token, audiences);

    const [existing] = await ctx.db
      .select({
        id: users.id,
        phoneVerifiedAt: users.phoneVerifiedAt,
        status: users.status,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.googleSub, identity.subject))
      .limit(1);

    let userId: string;
    let isNewUser = false;

    if (existing) {
      if (existing.deletedAt || existing.status !== 'ACTIVE') {
        throw new AppError(ERROR_CODES.ACCOUNT_SUSPENDED);
      }
      userId = existing.id;

      // Keep the display fields fresh; the subject is what identifies them.
      await ctx.db
        .update(users)
        .set({
          ...(identity.email ? { email: identity.email } : {}),
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
    } else {
      /*
       * A Google account whose email already belongs to somebody.
       *
       * Linking them automatically would let anyone who controls an address at
       * a provider Google trusts take over an existing account. It is refused,
       * and the customer signs in the way that account was created.
       */
      if (identity.email) {
        const [byEmail] = await ctx.db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, identity.email))
          .limit(1);

        if (byEmail) {
          throw new AppError(ERROR_CODES.CONFLICT, {
            messageAr: 'هذا البريد مرتبط بحساب آخر. سجّل الدخول برقم هاتفك.',
          });
        }
      }

      userId = uuidv7();
      isNewUser = true;
      await ctx.db.insert(users).values({
        id: userId,
        googleSub: identity.subject,
        email: identity.email,
        fullName: identity.name,
        status: 'ACTIVE',
        lastLoginAt: new Date(),
      });
    }

    const session = await issueSession(ctx, {
      userId,
      userAgent: userAgent(request),
      ip: clientIp(request),
      deviceId: body.deviceId ?? null,
    });

    const capabilities = await loadCapabilities(ctx, userId);
    const phoneVerified = existing ? existing.phoneVerifiedAt !== null : false;

    return reply.send(
      success(
        {
          access_token: session.accessToken,
          refresh_token: session.refreshToken,
          expires_in_seconds: session.expiresInSeconds,
          user: {
            id: userId,
            is_new_user: isNewUser,
            profile_completed: capabilities.profileCompleted,
            phone_verified: phoneVerified,
            modes: capabilities.modes,
            driver_id: capabilities.driverId,
            platform_roles: capabilities.platformRoles,
            restaurant_ids: Object.keys(capabilities.restaurantRoles),
          },
          /*
           * The phone comes before the profile: it is the harder gate, and
           * asking for a name first and a number second would let someone
           * finish onboarding and still be unable to order.
           */
          next_step: !phoneVerified
            ? ('VERIFY_PHONE' as const)
            : capabilities.profileCompleted
              ? ('HOME' as const)
              : ('COMPLETE_PROFILE' as const),
        },
        { request_id: request.requestId },
      ),
    );
  });

  /**
   * Attach a phone to the account I am already signed into.
   *
   * The second half of Google sign-in: Google proved who they are, this proves
   * a number a driver can call. Authenticated, so the number lands on the
   * account making the request and nowhere else.
   *
   * The OTP itself is requested through the normal `POST /auth/otp/request` —
   * same cooldown, same per-number and per-IP limits. There is no second, more
   * permissive path to a code just because someone is already signed in.
   */
  app.post('/api/v1/auth/phone/link', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = otpVerifySchema.parse(request.body);

    const verification = await verifyOtp(ctx, {
      phoneE164: body.phone,
      code: body.code,
      requestId: request.requestId,
      linkToUserId: principal.userId,
    });

    const capabilities = await loadCapabilities(ctx, verification.userId);

    return reply.send(
      success(
        {
          phone_verified: true,
          profile_completed: capabilities.profileCompleted,
          next_step: capabilities.profileCompleted
            ? ('HOME' as const)
            : ('COMPLETE_PROFILE' as const),
        },
        { request_id: request.requestId },
      ),
    );
  });

  app.get('/api/v1/auth/me', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const capabilities = await loadCapabilities(ctx, principal.userId);

    return reply.send(
      success(
        {
          user_id: principal.userId,
          full_name: capabilities.fullName,
          profile_completed: capabilities.profileCompleted,
          /*
           * Whether an order can be placed at all.
           *
           * A Google account starts without one, and the app routes to phone
           * verification on the strength of this rather than guessing.
           */
          phone_verified: capabilities.phoneVerified,
          modes: capabilities.modes,
          driver_id: capabilities.driverId,
          platform_roles: capabilities.platformRoles,
          restaurant_roles: capabilities.restaurantRoles,
          // The app needs a city id before it can list a single restaurant,
          // and the header shows the area by name.
          governorate_id: capabilities.area?.governorateId ?? null,
          governorate_name_ar: capabilities.area?.governorateNameAr ?? null,
          city_id: capabilities.area?.cityId ?? null,
          city_name_ar: capabilities.area?.cityNameAr ?? null,
        },
        { request_id: request.requestId },
      ),
    );
  });

  /**
   * Bootstrap configuration for the mobile client (plan §118, §119).
   * Unauthenticated: the app needs it before anyone signs in.
   */
  app.get('/api/v1/app/config', async (request, reply) => {
    const clientVersion =
      typeof request.headers['x-app-version'] === 'string'
        ? request.headers['x-app-version']
        : null;

    const version = await checkAppVersion(ctx, clientVersion);

    return reply.send(
      success(
        {
          minimum_version: version.minimumVersion,
          latest_version: version.latestVersion,
          update_required: version.updateRequired,
          update_available: version.updateAvailable,
        },
        { request_id: request.requestId },
      ),
    );
  });
}
