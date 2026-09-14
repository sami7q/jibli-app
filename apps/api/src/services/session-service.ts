import { and, eq, isNull } from 'drizzle-orm';
import { AppError, ERROR_CODES, type PlatformRole, type RestaurantRole } from '@jibli/contracts';
import { hashRefreshToken, signAccessToken } from '@jibli/auth';
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
  },
): Promise<IssuedSession> {
  const capabilities = await loadCapabilities(ctx, params.userId);

  const sessionId = uuidv7();
  const refreshToken = generateToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ctx.env.REFRESH_TOKEN_TTL_SECONDS * 1000);

  await ctx.db.insert(sessions).values({
    id: sessionId,
    userId: params.userId,
    // Only the hash is stored: a database read must not yield a usable token.
    refreshTokenHash: hashRefreshToken(refreshToken),
    userAgent: params.userAgent,
    ip: params.ip,
    deviceId: params.deviceId ?? null,
    mfaVerifiedAt: params.mfaVerified ? now : null,
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
      mfaAt: params.mfaVerified ? now.getTime() : null,
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

  if (session.revokedAt || session.supersededBySessionId) {
    await revokeSessionChain(ctx, session.userId, 'REFRESH_TOKEN_REPLAY');
    ctx.logger.warn(
      { event: 'session.refresh_replay', userId: session.userId },
      'Refresh token replay detected; all sessions revoked',
    );
    throw new AppError(ERROR_CODES.SESSION_EXPIRED);
  }

  if (session.expiresAt.getTime() < Date.now()) {
    throw new AppError(ERROR_CODES.SESSION_EXPIRED);
  }

  const issued = await issueSession(ctx, {
    userId: session.userId,
    userAgent: params.userAgent,
    ip: params.ip,
    deviceId: session.deviceId,
    // MFA freshness does not survive rotation; a sensitive action re-challenges.
    mfaVerified: false,
  });

  await ctx.db
    .update(sessions)
    .set({ supersededBySessionId: issued.sessionId, revokedAt: new Date(), revokedReason: 'ROTATED' })
    .where(eq(sessions.id, session.id));

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
