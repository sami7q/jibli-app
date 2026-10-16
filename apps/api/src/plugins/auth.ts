import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, ERROR_CODES, type PlatformRole, type RestaurantRole } from '@jibli/contracts';
import { MFA_FRESHNESS_SECONDS, verifyAccessToken, type Principal } from '@jibli/auth';
import { drivers, restaurantMembers, sessions, userPlatformRoles, users } from '@jibli/db';
import type { AppContext } from '../lib/context.js';
import { getConfig } from '../services/config-service.js';

/**
 * Authentication (plan §77).
 *
 * A bearer token proves identity. Authority is a separate question, answered by
 * the `@jibli/auth` guards against the principal assembled here.
 */

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

/**
 * Re-resolve authority from the database on every request.
 *
 * The token carries a snapshot of roles, but plan §86 requires that "a role
 * change takes effect server-side immediately". Reading membership fresh is what
 * makes a revoked cashier lose access mid-shift rather than at token expiry.
 */
async function resolvePrincipal(
  ctx: AppContext,
  claims: { sub: string; sid: string; mfaAt: number | null },
): Promise<Principal> {
  const [user] = await ctx.db
    .select({
      id: users.id,
      status: users.status,
      profileCompletedAt: users.profileCompletedAt,
      phoneVerifiedAt: users.phoneVerifiedAt,
      deletedAt: users.deletedAt,
      // Whether an authenticator exists on the account — not whether this
      // session has passed a challenge, which is `claims.mfaAt`.
      mfaEnabledAt: users.mfaEnabledAt,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .where(eq(users.id, claims.sub))
    .limit(1);

  if (!user || user.deletedAt) throw new AppError(ERROR_CODES.UNAUTHENTICATED);
  if (user.status !== 'ACTIVE') throw new AppError(ERROR_CODES.ACCOUNT_SUSPENDED);

  // A revoked session invalidates its access tokens immediately (plan §77).
  const [session] = await ctx.db
    .select({
      id: sessions.id,
      revokedAt: sessions.revokedAt,
      expiresAt: sessions.expiresAt,
      // The step-up stamp written by /auth/mfa/verify. Read here so a fresh
      // challenge takes effect without the client re-minting its token — the
      // admin portal re-derives tokens through refresh, which would otherwise
      // drop the claim and leave step-up actions permanently 401 (ADMIN-1).
      mfaVerifiedAt: sessions.mfaVerifiedAt,
    })
    .from(sessions)
    .where(eq(sessions.id, claims.sid))
    .limit(1);

  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
    throw new AppError(ERROR_CODES.SESSION_EXPIRED);
  }

  const platformRoleRows = await ctx.db
    .select({ role: userPlatformRoles.role })
    .from(userPlatformRoles)
    .where(and(eq(userPlatformRoles.userId, user.id), isNull(userPlatformRoles.revokedAt)));

  const membershipRows = await ctx.db
    .select({ restaurantId: restaurantMembers.restaurantId, role: restaurantMembers.role })
    .from(restaurantMembers)
    .where(and(eq(restaurantMembers.userId, user.id), eq(restaurantMembers.isActive, true)));

  const restaurantRoles: Record<string, RestaurantRole[]> = {};
  for (const row of membershipRows) {
    (restaurantRoles[row.restaurantId] ??= []).push(row.role);
  }

  const [driver] = await ctx.db
    .select({ id: drivers.id, status: drivers.status })
    .from(drivers)
    .where(eq(drivers.userId, user.id))
    .limit(1);

  const platformRoles = platformRoleRows.map((r) => r.role as PlatformRole);

  /*
   * Read per request, and only when it can matter.
   *
   * `require_mfa` is a platform setting an operator can turn on, and the rest
   * of this function already re-reads authority on every request so a change
   * takes effect immediately (plan §86). Baking it into the token would mean an
   * admin who was signed in when it was switched on keeps a session it does not
   * apply to.
   *
   * Skipped entirely for a customer, a driver or a restaurant member, which is
   * almost every request: the setting governs platform roles only, and this is
   * the hot path for the whole API.
   */
  const mfaRequiredByPolicy =
    platformRoles.length > 0 ? await getConfig(ctx, 'require_mfa', false) : false;

  /*
   * The freshest MFA moment available: the token's claim, or the session's
   * step-up stamp when it is still inside the freshness window. The stamp is
   * what /auth/mfa/verify writes, so a step-up works even on a token minted
   * before the challenge; `hasFreshMfa` still decides whether it is fresh
   * enough for a given action.
   */
  const claimMfaAt = claims.mfaAt ? new Date(claims.mfaAt) : null;
  const sessionMfaAt =
    session.mfaVerifiedAt &&
    Date.now() - session.mfaVerifiedAt.getTime() <= MFA_FRESHNESS_SECONDS * 1000
      ? session.mfaVerifiedAt
      : null;
  const mfaAt =
    claimMfaAt && sessionMfaAt
      ? claimMfaAt.getTime() >= sessionMfaAt.getTime()
        ? claimMfaAt
        : sessionMfaAt
      : (claimMfaAt ?? sessionMfaAt);

  return {
    userId: user.id,
    sessionId: session.id,
    platformRoles,
    restaurantRoles,
    // A suspended driver keeps their customer identity but loses Driver Mode.
    driverId: driver && driver.status === 'ACTIVE' ? driver.id : null,
    profileCompleted: user.profileCompletedAt !== null,
    phoneVerified: user.phoneVerifiedAt !== null,
    mfaAt,
    mfaEnrolled: user.mfaEnabledAt !== null,
    mfaRequiredByPolicy,
    mustChangePassword: user.mustChangePassword,
  };
}

/**
 * Routes a session with a staff-issued password may still reach before it has
 * been replaced (ADMIN-10): change the password, read who you are, or sign out.
 * Everything else is refused.
 */
const PASSWORD_CHANGE_EXEMPT_ROUTES: ReadonlySet<string> = new Set([
  '/api/v1/auth/password',
  '/api/v1/auth/me',
  '/api/v1/auth/portal/me',
  '/api/v1/auth/logout',
  '/api/v1/auth/session/logout',
  '/api/v1/restaurant-portal/password',
  '/api/v1/restaurant-portal/password/challenge',
]);

/**
 * Block a must-change-password session from doing anything but changing it.
 *
 * The client redirects to the change screen as a courtesy; this is the control
 * (ADMIN-10). Keyed on the matched route pattern so a query string cannot slip
 * past the allowlist.
 */
function assertPasswordChanged(request: FastifyRequest): void {
  if (!request.principal?.mustChangePassword) return;
  const route = request.routeOptions?.url ?? request.url.split('?')[0];
  if (route && PASSWORD_CHANGE_EXEMPT_ROUTES.has(route)) return;
  throw new AppError(ERROR_CODES.PASSWORD_CHANGE_REQUIRED);
}

export function registerAuth(app: FastifyInstance, ctx: AppContext): void {
  /**
   * Attach a principal when a valid token is present, without requiring one.
   * Public endpoints use this so they can personalise a response for a signed-in
   * customer while remaining open.
   */
  app.decorate('tryAuthenticate', async (request: FastifyRequest): Promise<void> => {
    const token = bearerToken(request);
    if (!token) return;
    try {
      const claims = await verifyAccessToken(token, {
        accessSecret: ctx.env.JWT_ACCESS_SECRET,
        refreshSecret: ctx.env.JWT_REFRESH_SECRET,
        accessTtlSeconds: ctx.env.ACCESS_TOKEN_TTL_SECONDS,
        refreshTtlSeconds: ctx.env.REFRESH_TOKEN_TTL_SECONDS,
      });
      request.principal = await resolvePrincipal(ctx, {
        sub: claims.sub,
        sid: claims.sid,
        mfaAt: claims.mfaAt,
      });
    } catch {
      // An invalid token on an optional-auth route is simply anonymous.
    }
  });

  /** Require a valid session. */
  app.decorate('authenticate', async (request: FastifyRequest, _reply: FastifyReply) => {
    const token = bearerToken(request);
    if (!token) throw new AppError(ERROR_CODES.UNAUTHENTICATED);

    let claims;
    try {
      claims = await verifyAccessToken(token, {
        accessSecret: ctx.env.JWT_ACCESS_SECRET,
        refreshSecret: ctx.env.JWT_REFRESH_SECRET,
        accessTtlSeconds: ctx.env.ACCESS_TOKEN_TTL_SECONDS,
        refreshTtlSeconds: ctx.env.REFRESH_TOKEN_TTL_SECONDS,
      });
    } catch (error) {
      // Distinguish expiry from tampering: the app silently refreshes on the
      // former and forces a re-login on the latter.
      const expired =
        typeof error === 'object' && error !== null && 'code' in error
          ? (error as { code?: string }).code === 'ERR_JWT_EXPIRED'
          : false;
      throw new AppError(expired ? ERROR_CODES.SESSION_EXPIRED : ERROR_CODES.UNAUTHENTICATED);
    }

    request.principal = await resolvePrincipal(ctx, {
      sub: claims.sub,
      sid: claims.sid,
      mfaAt: claims.mfaAt,
    });

    assertPasswordChanged(request);
  });
}

/** Narrowing helper for handlers that ran behind `authenticate`. */
export function requirePrincipal(request: FastifyRequest): Principal {
  if (!request.principal) throw new AppError(ERROR_CODES.UNAUTHENTICATED);
  return request.principal;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    tryAuthenticate: (request: FastifyRequest) => Promise<void>;
  }
}
