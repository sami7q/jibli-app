import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { success } from '@jibli/contracts';
import { iraqiPhoneSchema, otpCodeSchema } from '@jibli/validation';
import { clientIp, userAgent, type AppContext } from '../lib/context.js';
import { requestOtp, verifyOtp } from '../services/otp-service.js';
import {
  issueSession,
  loadCapabilities,
  refreshSession,
  revokeSession,
} from '../services/session-service.js';
import { requirePrincipal } from '../plugins/auth.js';
import { checkAppVersion } from '../services/config-service.js';

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
  app.get('/api/v1/auth/me', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const capabilities = await loadCapabilities(ctx, principal.userId);

    return reply.send(
      success(
        {
          user_id: principal.userId,
          full_name: capabilities.fullName,
          profile_completed: capabilities.profileCompleted,
          modes: capabilities.modes,
          driver_id: capabilities.driverId,
          platform_roles: capabilities.platformRoles,
          restaurant_roles: capabilities.restaurantRoles,
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
