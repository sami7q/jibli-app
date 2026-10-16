import { and, eq, isNull } from 'drizzle-orm';
import { AppError, ERROR_CODES, type PlatformRole, type RestaurantRole } from '@jibli/contracts';
import { hashRefreshToken, MFA_FRESHNESS_SECONDS, signAccessToken } from '@jibli/auth';
import {
  cities,
  drivers,
  generateToken,
  governorates,
  restaurantMembers,
  sessions,
  userPlatformRoles,
  users,
  uuidv7,
} from '@jibli/db';
import type { AppContext } from '../lib/context.js';

/**
 * Session issue, refresh and revocation (plan §77).
 *
 * Refresh tokens rotate: each use mints a new token and marks the old session
 * superseded. Presenting a token that has already been rotated means it was
 * stolen or replayed, and the whole chain is revoked.
 */

export interface IssuedSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
  readonly sessionId: string;
}

export interface SessionCapabilities {
  readonly platformRoles: PlatformRole[];
  readonly restaurantRoles: Record<string, RestaurantRole[]>;
  readonly driverId: string | null;
  readonly profileCompleted: boolean;
  /** Null until the profile-completion step runs (plan §11). */
  readonly fullName: string | null;
  /** Portal sign-in name. Null for a phone-only customer or driver. */
  readonly username: string | null;
  /** A password staff issued and nobody has replaced yet. */
  readonly mustChangePassword: boolean;
  /**
   * Whether a phone number has been proved.
   *
   * A Google sign-in does not prove one, and an order needs a number a driver
   * can call — so this gates checkout, not the session.
   */
  readonly phoneVerified: boolean;
  /** Which app modes the client should offer (plan §47). */
  readonly modes: ('CUSTOMER' | 'DRIVER')[];
  /**
   * Default discovery geography, with names (plan §12).
   *
   * The customer app cannot list a single restaurant without a city id —
   * `GET /restaurants` takes one — so a `me` without it leaves the home screen
   * permanently empty. The names ride along because the header shows the area
   * and a second round trip for two strings is waste.
   */
  readonly area: {
    readonly governorateId: string;
    readonly governorateNameAr: string;
    readonly cityId: string;
    readonly cityNameAr: string;
  } | null;
}

/** Load everything the client needs to decide which experience to show. */
export async function loadCapabilities(
  ctx: AppContext,
  userId: string,
): Promise<SessionCapabilities> {
  const [user] = await ctx.db
    // fullName rides along on a row already being read: the portals greet the
    // user by name, and a second round trip for one column is waste.
    .select({
      profileCompletedAt: users.profileCompletedAt,
      fullName: users.fullName,
      username: users.username,
      mustChangePassword: users.mustChangePassword,
      phoneVerifiedAt: users.phoneVerifiedAt,
      governorateId: users.profileGovernorateId,
      governorateNameAr: governorates.nameAr,
      cityId: users.profileCityId,
      cityNameAr: cities.nameAr,
    })
    .from(users)
    // Left joins: a portal account or a customer mid-signup has no area, and
    // that must not make them disappear from their own `me`.
    .leftJoin(cities, eq(cities.id, users.profileCityId))
    .leftJoin(governorates, eq(governorates.id, users.profileGovernorateId))
    .where(eq(users.id, userId))
    .limit(1);

  const platformRoleRows = await ctx.db
    .select({ role: userPlatformRoles.role })
    .from(userPlatformRoles)
    .where(and(eq(userPlatformRoles.userId, userId), isNull(userPlatformRoles.revokedAt)));

  const membershipRows = await ctx.db
    .select({ restaurantId: restaurantMembers.restaurantId, role: restaurantMembers.role })
    .from(restaurantMembers)
    .where(and(eq(restaurantMembers.userId, userId), eq(restaurantMembers.isActive, true)));

  const restaurantRoles: Record<string, RestaurantRole[]> = {};
  for (const row of membershipRows) {
    (restaurantRoles[row.restaurantId] ??= []).push(row.role);
  }

  const [driver] = await ctx.db
    .select({ id: drivers.id, status: drivers.status })
    .from(drivers)
    .where(eq(drivers.userId, userId))
    .limit(1);

  const driverId = driver && driver.status === 'ACTIVE' ? driver.id : null;

  // Everyone can order; Driver Mode appears only for an active driver.
  const modes: ('CUSTOMER' | 'DRIVER')[] = ['CUSTOMER'];
  if (driverId) modes.push('DRIVER');

  return {
    platformRoles: platformRoleRows.map((r) => r.role as PlatformRole),
    restaurantRoles,
    driverId,
    profileCompleted: user?.profileCompletedAt !== null && user?.profileCompletedAt !== undefined,
    fullName: user?.fullName ?? null,
    username: user?.username ?? null,
    mustChangePassword: user?.mustChangePassword ?? false,
    phoneVerified: user?.phoneVerifiedAt != null,
    modes,
    area:
      user?.cityId && user.cityNameAr && user.governorateId && user.governorateNameAr
        ? {
            governorateId: user.governorateId,
            governorateNameAr: user.governorateNameAr,
            cityId: user.cityId,
            cityNameAr: user.cityNameAr,
          }
        : null,
  };
}

export async function issueSession(
  ctx: AppContext,
  params: {
    userId: string;
    userAgent: string | null;
    ip: string | null;
    deviceId?: string | null;
    mfaVerified?: boolean;
    /**
     * An existing step-up moment to carry forward (a refresh keeping freshness
     * alive). Takes precedence over `mfaVerified`, which stamps "now".
     */
    mfaVerifiedAt?: Date | null;
  },
): Promise<IssuedSession> {
  const capabilities = await loadCapabilities(ctx, params.userId);

  const sessionId = uuidv7();
  const refreshToken = generateToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ctx.env.REFRESH_TOKEN_TTL_SECONDS * 1000);
  const mfaStamp = params.mfaVerifiedAt ?? (params.mfaVerified ? now : null);

  await ctx.db.insert(sessions).values({
    id: sessionId,
    userId: params.userId,
    // Only the hash is stored: a database read must not yield a usable token.
    refreshTokenHash: hashRefreshToken(refreshToken),
    userAgent: params.userAgent,
    ip: params.ip,
    deviceId: params.deviceId ?? null,
    mfaVerifiedAt: mfaStamp,
    expiresAt,
    lastUsedAt: now,
  });

  const accessToken = await signAccessToken(
    {
      sub: params.userId,
      sid: sessionId,
      platformRoles: capabilities.platformRoles,
      restaurantRoles: capabilities.restaurantRoles,
      driverId: capabilities.driverId,
      modes: capabilities.modes,
      profileCompleted: capabilities.profileCompleted,
      mfaAt: mfaStamp ? mfaStamp.getTime() : null,
    },
    {
      accessSecret: ctx.env.JWT_ACCESS_SECRET,
      refreshSecret: ctx.env.JWT_REFRESH_SECRET,
      accessTtlSeconds: ctx.env.ACCESS_TOKEN_TTL_SECONDS,
      refreshTtlSeconds: ctx.env.REFRESH_TOKEN_TTL_SECONDS,
    },
  );

  return {
    accessToken,
    refreshToken,
    expiresInSeconds: ctx.env.ACCESS_TOKEN_TTL_SECONDS,
    sessionId,
  };
}

/**
 * Rotate a refresh token.
 *
 * A token that has already been superseded is a replay: the legitimate client
 * would be holding the newest one. Revoking the entire chain is the standard
 * response — it costs the real user one re-login and shuts an attacker out.
 *
 * With one qualification, learned the hard way. Strict rotation assumes the
 * client received the new token; when it did not, the honest client is holding
 * an old one through no fault of its own and looks exactly like an attacker.
 * Two ways that happens here, both routine:
 *
 *   - the API sleeps on its free instance and the portal's proxy times out
 *     before it wakes. The response carrying the rotated token is lost. The
 *     next attempt presents the old one.
 *   - two tabs load at the same moment and both send the cookie that was
 *     current when they started.
 *
 * Either way every session the user has was revoked, on every device, because
 * a request timed out. So a short reuse window is allowed: a token superseded
 * seconds ago by an ordinary rotation is treated as the retry it almost
 * certainly is. Outside that window nothing changes — it is still a replay and
 * the chain still goes. The window is the same mechanism Auth0 calls rotation
 * leeway, and for the same reason.
 */
export async function refreshSession(
  ctx: AppContext,
  params: { refreshToken: string; userAgent: string | null; ip: string | null },
): Promise<IssuedSession> {
  const hash = hashRefreshToken(params.refreshToken);

  const [session] = await ctx.db
    .select()
    .from(sessions)
    .where(eq(sessions.refreshTokenHash, hash))
    .limit(1);

  if (!session) throw new AppError(ERROR_CODES.SESSION_EXPIRED);

  const superseded = session.revokedAt !== null || session.supersededBySessionId !== null;

  /*
   * A lost response, not a stolen token: this exact session was rotated
   * normally, moments ago, and nothing else has happened to it since.
   * `revokedReason` carries the distinction — a session revoked by logout, by
   * suspension or by an earlier replay does not qualify however recent it is.
   */
  const withinRotationLeeway =
    superseded &&
    session.revokedReason === 'ROTATED' &&
    session.revokedAt !== null &&
    Date.now() - session.revokedAt.getTime() <= ctx.env.REFRESH_ROTATION_LEEWAY_SECONDS * 1000;

  if (superseded && !withinRotationLeeway) {
    await revokeSessionChain(ctx, session.userId, 'REFRESH_TOKEN_REPLAY');
    ctx.logger.warn(
      { event: 'session.refresh_replay', userId: session.userId },
      'Refresh token replay detected; all sessions revoked',
    );
    throw new AppError(ERROR_CODES.SESSION_EXPIRED);
  }

  if (withinRotationLeeway) {
    // Logged at info, not warn: this is expected traffic on a flaky link, and
    // a warning that fires routinely is a warning nobody reads.
    ctx.logger.info(
      { event: 'session.refresh_reuse_in_leeway', userId: session.userId },
      'Refresh token reused within the rotation window; treated as a retry',
    );
  }

  if (session.expiresAt.getTime() < Date.now()) {
    throw new AppError(ERROR_CODES.SESSION_EXPIRED);
  }

  /*
   * Carry a still-fresh step-up forward across the rotation (ADMIN-1). The
   * admin portal re-derives its token through refresh, so dropping the stamp
   * here made every step-up action unreachable seconds after the challenge.
   * Only an MFA moment still inside the freshness window survives; an older one
   * is let go, which is the same as re-challenging.
   */
  const mfaVerifiedAt =
    session.mfaVerifiedAt &&
    Date.now() - session.mfaVerifiedAt.getTime() <= MFA_FRESHNESS_SECONDS * 1000
      ? session.mfaVerifiedAt
      : null;

  const issued = await issueSession(ctx, {
    userId: session.userId,
    userAgent: params.userAgent,
    ip: params.ip,
    deviceId: session.deviceId,
    mfaVerifiedAt,
  });

  /*
   * Only the first rotation records the successor. A retry inside the leeway
   * window must not repoint the chain at its own new session, or the link back
   * to what the first rotation actually issued is lost — and that link is what
   * a later replay investigation reads.
   */
  if (!superseded) {
    await ctx.db
      .update(sessions)
      .set({
        supersededBySessionId: issued.sessionId,
        revokedAt: new Date(),
        revokedReason: 'ROTATED',
      })
      .where(eq(sessions.id, session.id));
  }

  return issued;
}

export async function revokeSession(
  ctx: AppContext,
  sessionId: string,
  reason = 'LOGOUT',
): Promise<void> {
  await ctx.db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

/**
 * Revoke the session a refresh token belongs to.
 *
 * Portal logout holds the cookie, not a session id. Only the hash is stored, so
 * this looks up by hash rather than by the token itself.
 */
export async function revokeSessionByRefreshToken(
  ctx: AppContext,
  refreshToken: string,
  reason = 'LOGOUT',
): Promise<void> {
  await ctx.db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(
      and(
        eq(sessions.refreshTokenHash, hashRefreshToken(refreshToken)),
        isNull(sessions.revokedAt),
      ),
    );
}

/** Revoke every live session for a user — used on suspension and role removal. */
export async function revokeSessionChain(
  ctx: AppContext,
  userId: string,
  reason: string,
): Promise<number> {
  const revoked = await ctx.db
    .update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return revoked.length;
}
