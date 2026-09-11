import { and, count, desc, eq, gte, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  AppError,
  ERROR_CODES,
  MFA_MANDATORY_ROLES,
  success,
  type PlatformRole,
} from '@jibli/contracts';
import {
  buildTotpUri,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotpCode,
} from '@jibli/auth';
import { AUDIT_ACTIONS, writeAudit } from '@jibli/domain';
import {
  mfaAttempts,
  mfaRecoveryCodes,
  sessions,
  users,
  uuidv7,
} from '@jibli/db';
import { clientIp, userAgent, type AppContext } from '../lib/context.js';
import { requirePrincipal } from '../plugins/auth.js';

/**
 * MFA enrolment and verification (plan §88).
 *
 *   POST /api/v1/auth/mfa/enroll    — start enrolment, return the QR payload
 *   POST /api/v1/auth/mfa/confirm   — prove a code works, activate, issue codes
 *   POST /api/v1/auth/mfa/verify    — step-up challenge for a sensitive action
 *   POST /api/v1/auth/mfa/disable   — requires a current code
 *   GET  /api/v1/auth/mfa/status    — enrolment state and whether it is required
 *
 * Enrolment is two-phase on purpose: the secret sits pending until the user
 * proves they can generate a code from it. A one-phase flow lets an admin scan
 * a QR that silently failed and lock themselves out of the portal.
 */

/** Failed attempts allowed in the window before verification is refused. */
const MAX_ATTEMPTS_PER_WINDOW = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

/** An enrolment left unconfirmed this long is abandoned. */
const PENDING_ENROLMENT_TTL_MS = 10 * 60 * 1000;

const codeSchema = z.object({
  code: z
    .string()
    .min(6)
    .max(16)
    .transform((value) => value.replace(/\s/g, '')),
});

/**
 * Whether this principal is required to hold MFA.
 *
 * Derived from the role matrix rather than a per-user flag, so adding a Finance
 * Admin automatically brings the requirement with it.
 */
function mfaRequiredFor(roles: readonly PlatformRole[]): boolean {
  return roles.some((role) => MFA_MANDATORY_ROLES.includes(role));
}

/** Count recent failures. Lockout is per user, not per IP: the account is the asset. */
async function recentFailures(ctx: AppContext, userId: string): Promise<number> {
  const since = new Date(Date.now() - ATTEMPT_WINDOW_MS);
  const [row] = await ctx.db
    .select({ value: count() })
    .from(mfaAttempts)
    .where(
      and(
        eq(mfaAttempts.userId, userId),
        eq(mfaAttempts.succeeded, false),
        gte(mfaAttempts.createdAt, since),
      ),
    );
  return row?.value ?? 0;
}

async function recordAttempt(
  ctx: AppContext,
  params: { userId: string; succeeded: boolean; method: 'TOTP' | 'RECOVERY_CODE'; ip: string | null },
): Promise<void> {
  await ctx.db.insert(mfaAttempts).values({
    id: uuidv7(),
    userId: params.userId,
    succeeded: params.succeeded,
    method: params.method,
    ip: params.ip,
  });
}

/**
 * Check one MFA code for a user and consume it.
 *
 * Shared by step-up verification and by password login, so the lockout window,
 * the TOTP replay guard and the single-use recovery-code rule are enforced
 * identically on both paths. Two copies of this logic would eventually disagree
 * about what counts as a reused code.
 *
 * Throws RATE_LIMITED when locked out and OTP_INVALID on a bad code. Returns
 * the method that succeeded.
 */
export async function verifyTotpForUser(
  ctx: AppContext,
  params: { userId: string; code: string; ip: string | null; userAgent: string | null },
): Promise<{ method: 'TOTP' | 'RECOVERY_CODE' }> {
  // Checked first so a brute-force attempt cannot burn through codes.
  if ((await recentFailures(ctx, params.userId)) >= MAX_ATTEMPTS_PER_WINDOW) {
    throw new AppError(ERROR_CODES.RATE_LIMITED, {
      details: { reason: 'MFA_LOCKED', retryAfterSeconds: ATTEMPT_WINDOW_MS / 1000 },
    });
  }

  const [user] = await ctx.db
    .select({
      secret: users.mfaSecretEncrypted,
      mfaEnabledAt: users.mfaEnabledAt,
      lastUsedCounter: users.mfaLastUsedCounter,
    })
    .from(users)
    .where(eq(users.id, params.userId))
    .limit(1);

  if (!user?.secret || !user.mfaEnabledAt) {
    throw new AppError(ERROR_CODES.MFA_REQUIRED, { details: { reason: 'MFA_NOT_ENROLLED' } });
  }

  // A 6-digit value is a TOTP code; anything else is treated as a recovery code.
  const looksLikeTotp = /^\d{6}$/.test(params.code);

  if (looksLikeTotp) {
    const verification = verifyTotpCode(user.secret, params.code, {
      lastUsedCounter: user.lastUsedCounter,
    });

    if (!verification.valid) {
      await recordAttempt(ctx, {
        userId: params.userId,
        succeeded: false,
        method: 'TOTP',
        ip: params.ip,
      });
      throw new AppError(ERROR_CODES.OTP_INVALID);
    }

    // Advancing the counter is what blocks replay inside the same window.
    await ctx.db
      .update(users)
      .set({ mfaLastUsedCounter: verification.counter })
      .where(eq(users.id, params.userId));
  } else {
    // Single use, enforced by a conditional UPDATE so two concurrent
    // submissions cannot both consume the same code.
    const hash = hashRecoveryCode(params.code, ctx.env.OTP_HASH_PEPPER);

    const consumed = await ctx.db
      .update(mfaRecoveryCodes)
      .set({ usedAt: new Date(), usedIp: params.ip })
      .where(
        and(
          eq(mfaRecoveryCodes.userId, params.userId),
          eq(mfaRecoveryCodes.codeHash, hash),
          isNull(mfaRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: mfaRecoveryCodes.id });

    if (consumed.length === 0) {
      await recordAttempt(ctx, {
        userId: params.userId,
        succeeded: false,
        method: 'RECOVERY_CODE',
        ip: params.ip,
      });
      throw new AppError(ERROR_CODES.OTP_INVALID);
    }

    ctx.logger.warn(
      { event: 'mfa.recovery_code_used', userId: params.userId },
      'MFA recovery code consumed',
    );
  }

  await recordAttempt(ctx, {
    userId: params.userId,
    succeeded: true,
    method: looksLikeTotp ? 'TOTP' : 'RECOVERY_CODE',
    ip: params.ip,
  });

  return { method: looksLikeTotp ? 'TOTP' : 'RECOVERY_CODE' };
}

export function registerMfaRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/v1/auth/mfa/status', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);

    const [user] = await ctx.db
      .select({
        mfaEnabledAt: users.mfaEnabledAt,
        pendingStartedAt: users.mfaPendingStartedAt,
      })
      .from(users)
      .where(eq(users.id, principal.userId))
      .limit(1);

    const [remaining] = await ctx.db
      .select({ value: count() })
      .from(mfaRecoveryCodes)
      .where(
        and(eq(mfaRecoveryCodes.userId, principal.userId), isNull(mfaRecoveryCodes.usedAt)),
      );

    const required = mfaRequiredFor(principal.platformRoles);

    return reply.send(
      success(
        {
          enabled: user?.mfaEnabledAt !== null && user?.mfaEnabledAt !== undefined,
          required,
          // The portal uses this to block sensitive screens until enrolment
          // is done, rather than letting the user hit a wall mid-action.
          enrolment_pending: user?.pendingStartedAt !== null && user?.pendingStartedAt !== undefined,
          recovery_codes_remaining: remaining?.value ?? 0,
          enabled_at: user?.mfaEnabledAt?.toISOString() ?? null,
        },
        { request_id: request.requestId },
      ),
    );
  });

  /**
   * Begin enrolment.
   *
   * Returns the secret and an otpauth URI. The secret is stored as *pending* —
   * it grants nothing until a code proves the authenticator holds it.
   */
  app.post('/api/v1/auth/mfa/enroll', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);

    const [user] = await ctx.db
      .select({ mfaEnabledAt: users.mfaEnabledAt, phoneE164: users.phoneE164 })
      .from(users)
      .where(eq(users.id, principal.userId))
      .limit(1);

    if (!user) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'user' } });

    // Re-enrolling would invalidate the existing authenticator silently.
    // Disabling first is an explicit, code-protected action.
    if (user.mfaEnabledAt) {
      throw new AppError(ERROR_CODES.CONFLICT, {
        details: { reason: 'MFA_ALREADY_ENABLED' },
      });
    }

    const secret = generateTotpSecret();

    await ctx.db
      .update(users)
      .set({
        mfaPendingSecretEncrypted: secret,
        mfaPendingStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, principal.userId));

    return reply.send(
      success(
        {
          secret,
          // The portal renders this as a QR code.
          otpauth_uri: buildTotpUri({
            secretBase32: secret,
            accountName: user.phoneE164,
            issuer: 'Jibli',
          }),
          expires_in_seconds: PENDING_ENROLMENT_TTL_MS / 1000,
        },
        { request_id: request.requestId },
      ),
    );
  });

  /**
   * Confirm enrolment with a code from the authenticator.
   *
   * Only here does MFA actually become active, and only here are recovery codes
   * issued — they are shown exactly once (plan §88).
   */
  app.post('/api/v1/auth/mfa/confirm', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = codeSchema.parse(request.body);

    const plaintextCodes = await ctx.db.transaction(async (tx) => {
      const [user] = await tx
        .select({
          mfaEnabledAt: users.mfaEnabledAt,
          pendingSecret: users.mfaPendingSecretEncrypted,
          pendingStartedAt: users.mfaPendingStartedAt,
        })
        .from(users)
        .where(eq(users.id, principal.userId))
        .for('update')
        .limit(1);

      if (!user?.pendingSecret || !user.pendingStartedAt) {
        throw new AppError(ERROR_CODES.CONFLICT, { details: { reason: 'NO_PENDING_ENROLMENT' } });
      }

      if (Date.now() - user.pendingStartedAt.getTime() > PENDING_ENROLMENT_TTL_MS) {
        // Clear it so the next attempt starts cleanly rather than retrying a
        // secret the user's app may no longer show.
        await tx
          .update(users)
          .set({ mfaPendingSecretEncrypted: null, mfaPendingStartedAt: null })
          .where(eq(users.id, principal.userId));
        throw new AppError(ERROR_CODES.CONFLICT, { details: { reason: 'ENROLMENT_EXPIRED' } });
      }

      const verification = verifyTotpCode(user.pendingSecret, body.code);
      if (!verification.valid) {
        throw new AppError(ERROR_CODES.OTP_INVALID, { details: { reason: 'TOTP_INVALID' } });
      }

      const now = new Date();
      const codes = generateRecoveryCodes();

      await tx
        .update(users)
        .set({
          mfaSecretEncrypted: user.pendingSecret,
          mfaEnabledAt: now,
          mfaLastUsedCounter: verification.counter,
          mfaPendingSecretEncrypted: null,
          mfaPendingStartedAt: null,
          updatedAt: now,
        })
        .where(eq(users.id, principal.userId));

      // Replace any previous set: re-enrolment must not leave old codes live.
      await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, principal.userId));

      await tx.insert(mfaRecoveryCodes).values(
        codes.map((code) => ({
          id: uuidv7(),
          userId: principal.userId,
          codeHash: hashRecoveryCode(code, ctx.env.OTP_HASH_PEPPER),
        })),
      );

      await writeAudit(tx, {
        actorUserId: principal.userId,
        action: AUDIT_ACTIONS.ROLE_GRANT,
        entityType: 'user_mfa',
        entityId: principal.userId,
        after: { mfaEnabled: true, recoveryCodesIssued: codes.length },
        ip: clientIp(request),
        userAgent: userAgent(request),
        requestId: request.requestId,
      });

      return codes;
    });

    await recordAttempt(ctx, {
      userId: principal.userId,
      succeeded: true,
      method: 'TOTP',
      ip: clientIp(request),
    });

    ctx.logger.info(
      { event: 'mfa.enrolled', userId: principal.userId, requestId: request.requestId },
      'MFA enrolment confirmed',
    );

    return reply.send(
      success(
        {
          enabled: true,
          // Shown once. The client must make the user acknowledge saving them.
          recovery_codes: plaintextCodes,
          warning_ar:
            'احفظ رموز الاسترداد في مكان آمن. لن تظهر مرة أخرى، وهي وسيلتك الوحيدة للدخول إذا فقدت هاتفك.',
        },
        { request_id: request.requestId },
      ),
    );
  });

  /**
   * Step-up verification for a sensitive action (plan §88).
   *
   * Stamps the session so `hasFreshMfa` passes for the next 15 minutes.
   */
  app.post('/api/v1/auth/mfa/verify', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = codeSchema.parse(request.body);
    const ip = clientIp(request);

    // One implementation for both paths: see verifyTotpForUser above.
    await verifyTotpForUser(ctx, {
      userId: principal.userId,
      code: body.code,
      ip,
      userAgent: userAgent(request),
    });

    // Stamp the session. This is what `hasFreshMfa` reads for step-up checks.
    await ctx.db
      .update(sessions)
      .set({ mfaVerifiedAt: new Date() })
      .where(eq(sessions.id, principal.sessionId));

    return reply.send(
      success(
        {
          verified: true,
          // The client re-fetches its token so the new mfaAt claim is present.
          reauthentication_required: true,
        },
        { request_id: request.requestId },
      ),
    );
  });

  /**
   * Disable MFA. Requires a current code — otherwise a hijacked session could
   * strip the very control protecting the account.
   */
  app.post('/api/v1/auth/mfa/disable', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);
    const body = codeSchema.parse(request.body);

    // A role that mandates MFA cannot opt out (plan §88). Support "cannot simply
    // disable MFA because a user requests it informally."
    if (mfaRequiredFor(principal.platformRoles)) {
      throw new AppError(ERROR_CODES.FORBIDDEN, {
        details: { reason: 'MFA_MANDATORY_FOR_ROLE', roles: principal.platformRoles },
      });
    }

    await ctx.db.transaction(async (tx) => {
      const [user] = await tx
        .select({ secret: users.mfaSecretEncrypted, lastUsedCounter: users.mfaLastUsedCounter })
        .from(users)
        .where(eq(users.id, principal.userId))
        .for('update')
        .limit(1);

      if (!user?.secret) {
        throw new AppError(ERROR_CODES.CONFLICT, { details: { reason: 'MFA_NOT_ENROLLED' } });
      }

      if (!verifyTotpCode(user.secret, body.code, { lastUsedCounter: user.lastUsedCounter }).valid) {
        throw new AppError(ERROR_CODES.OTP_INVALID);
      }

      await tx
        .update(users)
        .set({
          mfaSecretEncrypted: null,
          mfaEnabledAt: null,
          mfaLastUsedCounter: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, principal.userId));

      await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, principal.userId));

      await writeAudit(tx, {
        actorUserId: principal.userId,
        action: AUDIT_ACTIONS.ROLE_REVOKE,
        entityType: 'user_mfa',
        entityId: principal.userId,
        before: { mfaEnabled: true },
        after: { mfaEnabled: false },
        ip: clientIp(request),
        userAgent: userAgent(request),
        requestId: request.requestId,
      });
    });

    return reply.send(success({ enabled: false }, { request_id: request.requestId }));
  });

  /** Reissue recovery codes. Invalidates the previous set. */
  app.post(
    '/api/v1/auth/mfa/recovery-codes',
    { preHandler: app.authenticate },
    async (request, reply) => {
      const principal = requirePrincipal(request);
      const body = codeSchema.parse(request.body);

      const codes = await ctx.db.transaction(async (tx) => {
        const [user] = await tx
          .select({ secret: users.mfaSecretEncrypted, lastUsedCounter: users.mfaLastUsedCounter })
          .from(users)
          .where(eq(users.id, principal.userId))
          .for('update')
          .limit(1);

        if (!user?.secret) {
          throw new AppError(ERROR_CODES.CONFLICT, { details: { reason: 'MFA_NOT_ENROLLED' } });
        }
        if (
          !verifyTotpCode(user.secret, body.code, { lastUsedCounter: user.lastUsedCounter }).valid
        ) {
          throw new AppError(ERROR_CODES.OTP_INVALID);
        }

        const fresh = generateRecoveryCodes();

        await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, principal.userId));
        await tx.insert(mfaRecoveryCodes).values(
          fresh.map((code) => ({
            id: uuidv7(),
            userId: principal.userId,
            codeHash: hashRecoveryCode(code, ctx.env.OTP_HASH_PEPPER),
          })),
        );

        return fresh;
      });

      return reply.send(
        success({ recovery_codes: codes }, { request_id: request.requestId }),
      );
    },
  );

  /** Recent MFA activity, so an admin can spot an unexpected recovery use. */
  app.get('/api/v1/auth/mfa/activity', { preHandler: app.authenticate }, async (request, reply) => {
    const principal = requirePrincipal(request);

    const rows = await ctx.db
      .select({
        succeeded: mfaAttempts.succeeded,
        method: mfaAttempts.method,
        createdAt: mfaAttempts.createdAt,
      })
      .from(mfaAttempts)
      .where(eq(mfaAttempts.userId, principal.userId))
      .orderBy(desc(mfaAttempts.createdAt))
      .limit(20);

    return reply.send(
      success(
        rows.map((row) => ({
          succeeded: row.succeeded,
          method: row.method,
          at: row.createdAt.toISOString(),
        })),
        { request_id: request.requestId },
      ),
    );
  });
}
