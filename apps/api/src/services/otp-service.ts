import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { AppError, ERROR_CODES } from '@jibli/contracts';
import { hashShortCode, safeCompare } from '@jibli/auth';
import { generateNumericCode, otpChallenges, users, uuidv7 } from '@jibli/db';
import { NOTIFICATION_TEMPLATES, AllowlistSmsProvider } from '@jibli/notifications';
import { parseCsv } from '@jibli/config';
import { maskPhoneForLog } from '@jibli/logger';
import type { AppContext } from '../lib/context.js';

/**
 * OTP issue and verification (plan §10, §78).
 *
 * Controls required by the plan and implemented here:
 *   - per-number cooldown
 *   - per-number hourly and daily limits
 *   - IP-based limits
 *   - limited verification attempts
 *   - challenge expiry
 *   - no account-existence leakage
 *   - OTP values never logged or returned
 */

export interface OtpRequestInput {
  readonly phoneE164: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly requestId: string;
}

export interface OtpRequestResult {
  /** Seconds until another code may be requested. */
  readonly resendAfterSeconds: number;
  readonly expiresInSeconds: number;
  /** Local/dev convenience only; never populated outside development. */
  readonly devCode?: string;
}

/** Redis keys for the counters that back the abuse limits. */
const keys = {
  cooldown: (phone: string) => `otp:cooldown:${phone}`,
  perPhoneHour: (phone: string) => `otp:phone:h:${phone}`,
  perPhoneDay: (phone: string) => `otp:phone:d:${phone}`,
  perIpHour: (ip: string) => `otp:ip:h:${ip}`,
};

/**
 * Increment a counter with a TTL, returning the new value.
 *
 * The TTL is only set on first increment, so the window is fixed rather than
 * sliding forward with every attempt — otherwise a persistent attacker would
 * keep pushing the expiry out and never reset.
 */
async function incrementWithWindow(
  ctx: AppContext,
  key: string,
  windowSeconds: number,
): Promise<number> {
  const value = await ctx.redis.incr(key);
  if (value === 1) await ctx.redis.expire(key, windowSeconds);
  return value;
}

export async function requestOtp(
  ctx: AppContext,
  input: OtpRequestInput,
): Promise<OtpRequestResult> {
  const { env } = ctx;
  const phone = input.phoneE164;

  // 1. Cooldown — stops a tap-happy user (or a script) from burning SMS budget.
  const cooldownTtl = await ctx.redis.ttl(keys.cooldown(phone));
  if (cooldownTtl > 0) {
    throw new AppError(ERROR_CODES.OTP_COOLDOWN_ACTIVE, {
      details: { resendAfterSeconds: cooldownTtl },
    });
  }

  // 2. Volume limits per number and per IP.
  const perHour = await incrementWithWindow(ctx, keys.perPhoneHour(phone), 3600);
  if (perHour > env.OTP_MAX_PER_PHONE_HOUR) {
    ctx.logger.warn(
      { event: 'otp.rate_limited', scope: 'phone_hour', phone: maskPhoneForLog(phone) },
      'OTP hourly limit exceeded',
    );
    throw new AppError(ERROR_CODES.OTP_RATE_LIMITED, { details: { window: 'hour' } });
  }

  const perDay = await incrementWithWindow(ctx, keys.perPhoneDay(phone), 86_400);
  if (perDay > env.OTP_MAX_PER_PHONE_DAY) {
    ctx.logger.warn(
      { event: 'otp.rate_limited', scope: 'phone_day', phone: maskPhoneForLog(phone) },
      'OTP daily limit exceeded',
    );
    throw new AppError(ERROR_CODES.OTP_RATE_LIMITED, { details: { window: 'day' } });
  }

  if (input.ip) {
    const perIp = await incrementWithWindow(ctx, keys.perIpHour(input.ip), 3600);
    if (perIp > env.OTP_MAX_PER_IP_HOUR) {
      ctx.logger.warn({ event: 'otp.rate_limited', scope: 'ip_hour' }, 'OTP IP limit exceeded');
      throw new AppError(ERROR_CODES.OTP_RATE_LIMITED, { details: { window: 'ip_hour' } });
    }
  }

  // 3. Invalidate any outstanding challenge, so only the newest code works.
  await ctx.db
    .update(otpChallenges)
    .set({ consumedAt: new Date() })
    .where(and(eq(otpChallenges.phoneE164, phone), isNull(otpChallenges.consumedAt)));

  /*
   * `mock` makes the code a fixed one — any number signs in with 0000.
   *
   * It replaces the *generated* code rather than short-circuiting
   * verification, which matters: the challenge is still stored, hashed and
   * salted the same way, still expires, still counts attempts, and is still
   * rate limited. Every rule a real sign-in obeys is exercised; only the
   * randomness is removed. A bypass in `verifyOtp` would have tested none of
   * it and would have been one edit away from reaching production.
   *
   * And it cannot reach production: the env schema refuses to validate any
   * provider but `sms_gateway` when APP_ENV is production.
   */
  const code =
    env.OTP_PROVIDER === 'mock'
      ? env.OTP_MOCK_CODE.slice(0, env.OTP_LENGTH).padEnd(env.OTP_LENGTH, '0')
      : generateNumericCode(env.OTP_LENGTH);
  const challengeId = uuidv7();
  const expiresAt = new Date(Date.now() + env.OTP_TTL_SECONDS * 1000);

  await ctx.db.insert(otpChallenges).values({
    id: challengeId,
    phoneE164: phone,
    // Salted by challenge ID so two challenges for the same code hash differently.
    codeHash: hashShortCode(code, env.OTP_HASH_PEPPER, challengeId),
    purpose: 'LOGIN',
    maxAttempts: env.OTP_MAX_VERIFY_ATTEMPTS,
    expiresAt,
    requestIp: input.ip,
    requestUserAgent: input.userAgent,
  });

  // 4. Deliver. The staging allowlist wraps the provider so a non-production
  //    deployment cannot text an arbitrary real number (plan §7).
  const allowlist = parseCsv(env.OTP_PHONE_ALLOWLIST);
  const provider =
    allowlist.length > 0
      ? new AllowlistSmsProvider(ctx.sms, allowlist, ctx.logger)
      : ctx.sms;

  const template = NOTIFICATION_TEMPLATES.otpCode(code);
  const delivery = await provider.send({ toE164: phone, body: template.bodyAr });

  if (!delivery.ok) {
    ctx.logger.error(
      { event: 'otp.delivery_failed', phone: maskPhoneForLog(phone), reason: delivery.error },
      'OTP delivery failed',
    );
    throw new AppError(ERROR_CODES.OTP_DELIVERY_FAILED);
  }

  await ctx.redis.set(keys.cooldown(phone), '1', 'EX', env.OTP_RESEND_COOLDOWN_SECONDS);

  ctx.logger.info(
    { event: 'otp.requested', phone: maskPhoneForLog(phone), requestId: input.requestId },
    'OTP issued',
  );

  return {
    resendAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS,
    expiresInSeconds: env.OTP_TTL_SECONDS,
    /*
     * Returned when a developer is meant to see it: local development, or the
     * mock provider — where the code is fixed and public anyway, so hiding it
     * protects nothing and only makes testing slower.
     */
    ...(env.APP_ENV === 'local' || env.OTP_PROVIDER === 'mock' ? { devCode: code } : {}),
  };
}

export interface OtpVerifyResult {
  readonly userId: string;
  readonly isNewUser: boolean;
  readonly profileCompleted: boolean;
}

export async function verifyOtp(
  ctx: AppContext,
  input: {
    phoneE164: string;
    code: string;
    requestId: string;
    /**
     * Attach the number to this account instead of finding one by phone.
     *
     * Set when a customer who signed in with Google is adding the phone an
     * order needs. Everything before this point is identical — the same
     * challenge, the same expiry, the same attempt counting — because the
     * question being answered is the same: does this person hold this number?
     */
    linkToUserId?: string;
  },
): Promise<OtpVerifyResult> {
  const now = new Date();

  const [challenge] = await ctx.db
    .select()
    .from(otpChallenges)
    .where(and(eq(otpChallenges.phoneE164, input.phoneE164), isNull(otpChallenges.consumedAt)))
    .orderBy(desc(otpChallenges.createdAt))
    .limit(1);

  if (!challenge) {
    // No live challenge. Deliberately indistinguishable from a wrong code, so a
    // prober cannot learn whether a number was ever sent one.
    throw new AppError(ERROR_CODES.OTP_INVALID);
  }

  if (challenge.expiresAt.getTime() < now.getTime()) {
    throw new AppError(ERROR_CODES.OTP_EXPIRED);
  }

  if (challenge.attemptCount >= challenge.maxAttempts) {
    throw new AppError(ERROR_CODES.OTP_MAX_ATTEMPTS);
  }

  const candidate = hashShortCode(input.code, ctx.env.OTP_HASH_PEPPER, challenge.id);
  if (!safeCompare(candidate, challenge.codeHash)) {
    // Count the failure atomically so parallel guesses cannot share one budget.
    await ctx.db
      .update(otpChallenges)
      .set({ attemptCount: sql`${otpChallenges.attemptCount} + 1` })
      .where(eq(otpChallenges.id, challenge.id));

    ctx.logger.info(
      {
        event: 'otp.verify_failed',
        phone: maskPhoneForLog(input.phoneE164),
        attempt: challenge.attemptCount + 1,
      },
      'OTP verification failed',
    );
    throw new AppError(ERROR_CODES.OTP_INVALID, {
      details: { attemptsRemaining: challenge.maxAttempts - challenge.attemptCount - 1 },
    });
  }

  // Consume the challenge before issuing a session: a replayed request must not
  // mint a second session from the same code.
  const consumed = await ctx.db
    .update(otpChallenges)
    .set({ consumedAt: now })
    .where(and(eq(otpChallenges.id, challenge.id), isNull(otpChallenges.consumedAt)))
    .returning({ id: otpChallenges.id });

  if (consumed.length === 0) throw new AppError(ERROR_CODES.OTP_INVALID);

  /*
   * Linking: the account already exists, the number is what is new.
   *
   * A number already on another account is refused rather than moved. Moving
   * it would take a phone-only customer's orders, addresses and history away
   * from them silently — and the person doing it would only have had to know
   * their number.
   */
  if (input.linkToUserId) {
    const [owner] = await ctx.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.phoneE164, input.phoneE164))
      .limit(1);

    if (owner && owner.id !== input.linkToUserId) {
      throw new AppError(ERROR_CODES.CONFLICT, {
        messageAr: 'هذا الرقم مرتبط بحساب آخر. سجّل الدخول به، أو استخدم رقماً غيره.',
      });
    }

    const [linked] = await ctx.db
      .update(users)
      .set({ phoneE164: input.phoneE164, phoneVerifiedAt: now, lastLoginAt: now, updatedAt: now })
      .where(eq(users.id, input.linkToUserId))
      .returning({ id: users.id, profileCompletedAt: users.profileCompletedAt });

    if (!linked) throw new AppError(ERROR_CODES.NOT_FOUND, { details: { entity: 'user' } });

    ctx.logger.info(
      { event: 'user.phone_linked', userId: linked.id, requestId: input.requestId },
      'Phone number attached to an existing account',
    );

    return {
      userId: linked.id,
      isNewUser: false,
      profileCompleted: linked.profileCompletedAt !== null,
    };
  }

  // Find or create the identity. One identity per phone: a customer who is later
  // made a driver reuses this row (plan §45).
  const [existing] = await ctx.db
    .select({
      id: users.id,
      status: users.status,
      profileCompletedAt: users.profileCompletedAt,
    })
    .from(users)
    .where(eq(users.phoneE164, input.phoneE164))
    .limit(1);

  if (existing) {
    if (existing.status !== 'ACTIVE') throw new AppError(ERROR_CODES.ACCOUNT_SUSPENDED);
    await ctx.db
      .update(users)
      .set({ phoneVerifiedAt: now, lastLoginAt: now, updatedAt: now })
      .where(eq(users.id, existing.id));
    return {
      userId: existing.id,
      isNewUser: false,
      profileCompleted: existing.profileCompletedAt !== null,
    };
  }

  const userId = uuidv7();
  await ctx.db.insert(users).values({
    id: userId,
    phoneE164: input.phoneE164,
    phoneVerifiedAt: now,
    lastLoginAt: now,
    status: 'ACTIVE',
  });

  ctx.logger.info(
    { event: 'user.created', userId, requestId: input.requestId },
    'New customer identity created via OTP',
  );

  return { userId, isNewUser: true, profileCompleted: false };
}

/** Scheduled cleanup of spent and expired challenges (plan §94). */
export async function purgeExpiredOtpChallenges(ctx: AppContext): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const deleted = await ctx.db
    .delete(otpChallenges)
    .where(gte(sql`${cutoff}`, otpChallenges.expiresAt))
    .returning({ id: otpChallenges.id });
  return deleted.length;
}
