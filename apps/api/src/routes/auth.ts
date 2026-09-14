import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError, ERROR_CODES, success } from '@jibli/contracts';
import { iraqiPhoneSchema, otpCodeSchema } from '@jibli/validation';
import { clientIp, userAgent, type AppContext } from '../lib/context.js';
import { requestOtp, verifyOtp } from '../services/otp-service.js';
import { verifyGoogleIdToken } from '../services/google-identity.js';
import {
  issueSession,
  loadCapabilities,
  refreshSession,
  revokeSession,
} from '../services/session-service.js';
import { requirePrincipal } from '../plugins/auth.js';
import { checkAppVersion } from '../services/config-service.js';
import { eq } from 'drizzle-orm';
import { users, uuidv7 } from '@jibli/db';

/**
 * Authentication routes (plan §10, §77).
 *
 *   POST /api/v1/auth/otp/request
 *   POST /api/v1/auth/otp/verify
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
