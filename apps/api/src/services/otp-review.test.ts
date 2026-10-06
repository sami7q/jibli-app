import { describe, expect, it } from 'vitest';
import { loadApiEnv } from '@jibli/config';
import { hashShortCode } from '@jibli/auth';
import type { AppContext } from '../lib/context.js';
import { consumeOtpChallenge, requestOtp } from './otp-service.js';

/**
 * The Google Play review number.
 *
 * One customer number signs in with a code fixed in the environment and is
 * never sent a message, so a reviewer outside Iraq can reach every screen.
 * The assertions that matter are the ones about everybody else: the next
 * number still gets a random code through the real gateway, the review code
 * opens nothing but the review number, and the code itself never leaves the
 * server — not in the response, not in a log line, not in a message body.
 */

const PEPPER = 'p'.repeat(48);
const REVIEW_PHONE = '+9647700001234';
const REVIEW_CODE = '7391';
const OTHER_PHONE = '+9647801112233';

interface Captured {
  challengeId: string;
  codeHash: string;
  smsBodies: string[];
  providerNames: string[];
  counters: string[];
  /** Every log call, serialised, so a leaked code would be found wherever it sat. */
  logLines: string[];
}

function makeContext(
  extraEnv: Record<string, string> = {},
  limitsExhausted = false,
  /** What the day's wrong-guess counter for the review number already reads. */
  reviewFailures: number | null = null,
): { ctx: AppContext; captured: Captured } {
  const captured: Captured = {
    challengeId: '',
    codeHash: '',
    smsBodies: [],
    providerNames: [],
    counters: [],
    logLines: [],
  };

  const env = loadApiEnv({
    APP_ENV: 'staging',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/jibli',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    OTP_HASH_PEPPER: PEPPER,
    OTP_PROVIDER: 'sms_gateway',
    SMS_GATEWAY_URL: 'https://api.otpiq.com/api/sms',
    SMS_GATEWAY_API_KEY: 'sk_test_not_real',
    GOOGLE_PLAY_REVIEW_ENABLED: 'true',
    GOOGLE_PLAY_REVIEW_PHONE: REVIEW_PHONE,
    GOOGLE_PLAY_REVIEW_OTP_CODE: REVIEW_CODE,
    ...extraEnv,
  });

  const db = {
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({
      values: async (row: { id: string; codeHash: string }) => {
        captured.challengeId = row.id;
        captured.codeHash = row.codeHash;
      },
    }),
  };

  const redis = {
    get: async (key: string) => {
      captured.counters.push(`get ${key}`);
      return key === 'otp:review:failures' && reviewFailures !== null
        ? String(reviewFailures)
        : null;
    },
    ttl: async (key: string) => {
      captured.counters.push(`ttl ${key}`);
      return limitsExhausted ? 30 : -2;
    },
    incr: async (key: string) => {
      captured.counters.push(`incr ${key}`);
      return limitsExhausted ? 99 : 1;
    },
    expire: async () => 1,
    set: async (key: string) => {
      captured.counters.push(`set ${key}`);
      return 'OK';
    },
  };

  const record = (...args: unknown[]) => {
    captured.logLines.push(JSON.stringify(args));
  };
  const logger = {
    info: record,
    warn: record,
    error: record,
    debug: record,
    trace: record,
    child: () => logger,
  };

  /** Stands in for the live OTPIQ gateway: what reaches it is what a customer gets. */
  const sms = {
    name: 'sms_gateway',
    send: async (message: { body: string }) => {
      captured.providerNames.push('sms_gateway');
      captured.smsBodies.push(message.body);
      return { ok: true, providerMessageId: 'x' };
    },
  };

  const ctx = {
    env,
    db,
    redis,
    logger,
    sms,
    push: { name: 'console', send: async () => ({ ok: true }), sendMany: async () => [] },
  } as unknown as AppContext;

  return { ctx, captured };
}

const request = (ctx: AppContext, phone: string, ip: string | null = null) =>
  requestOtp(ctx, { phoneE164: phone, ip, userAgent: null, requestId: 'r1' });

const hashOf = (code: string, challengeId: string) => hashShortCode(code, PEPPER, challengeId);

describe('requestOtp() for the Google Play review number', () => {
  it('stores the fixed review code — hashed and salted like any other', async () => {
    const { ctx, captured } = makeContext();

    await request(ctx, REVIEW_PHONE);

    expect(captured.challengeId).not.toBe('');
    expect(captured.codeHash).toBe(hashOf(REVIEW_CODE, captured.challengeId));
  });

  it('leaves every other number on a random code through the real gateway', async () => {
    const { ctx, captured } = makeContext();

    const result = await request(ctx, OTHER_PHONE);

    expect(captured.codeHash).not.toBe(hashOf(REVIEW_CODE, captured.challengeId));
    expect(captured.providerNames).toEqual(['sms_gateway']);
    expect(captured.smsBodies).toHaveLength(1);
    expect(result.devCode).toBeUndefined();
    // The ordinary limits still apply to it.
    expect(captured.counters).toContain(`incr otp:phone:h:${OTHER_PHONE}`);
    expect(captured.counters).toContain(`set otp:cooldown:${OTHER_PHONE}`);
    expect(result.resendAfterSeconds).toBe(ctx.env.OTP_RESEND_COOLDOWN_SECONDS);
  });

  it('never returns the review code — not even where dev codes are shown', async () => {
    const staging = makeContext();
    expect((await request(staging.ctx, REVIEW_PHONE)).devCode).toBeUndefined();

    const local = makeContext({ APP_ENV: 'local', OTP_PROVIDER: 'console' });
    const result = await request(local.ctx, REVIEW_PHONE);
    expect(result.devCode).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(REVIEW_CODE);
  });

  it('sends nothing and logs nothing that contains the code', async () => {
    const { ctx, captured } = makeContext();

    await request(ctx, REVIEW_PHONE);

    expect(captured.providerNames).toEqual([]);
    expect(captured.smsBodies).toEqual([]);
    expect(captured.logLines.length).toBeGreaterThan(0);
    for (const line of captured.logLines) {
      expect(line).not.toContain(REVIEW_CODE);
      expect(line).not.toContain(REVIEW_PHONE);
    }
    expect(captured.logLines.some((line) => line.includes('otp.review_challenge_issued'))).toBe(
      true,
    );
  });

  it('skips the per-number limits, so a reviewer is never locked out, but not the IP one', async () => {
    const { ctx, captured } = makeContext({}, true);

    await expect(request(ctx, REVIEW_PHONE, '10.0.0.1')).rejects.toMatchObject({
      code: 'OTP_RATE_LIMITED',
      details: { window: 'ip_hour' },
    });
    expect(captured.counters.some((c) => c.includes('otp:cooldown'))).toBe(false);
    expect(captured.counters.some((c) => c.includes('otp:phone:'))).toBe(false);
    expect(captured.counters).toContain('incr otp:ip:h:10.0.0.1');

    // The same exhausted limits refuse an ordinary number as they always did.
    const other = makeContext({}, true);
    await expect(request(other.ctx, OTHER_PHONE)).rejects.toMatchObject({
      code: 'OTP_COOLDOWN_ACTIVE',
    });
  });

  it("refuses a new code once the day's wrong-guess budget is spent", async () => {
    const { ctx, captured } = makeContext({}, false, 10);

    await expect(request(ctx, REVIEW_PHONE)).rejects.toMatchObject({
      code: 'OTP_RATE_LIMITED',
      details: { window: 'review_day' },
    });
    // No challenge was written, and no message went anywhere.
    expect(captured.challengeId).toBe('');
    expect(captured.providerNames).toEqual([]);
    expect(captured.logLines.some((line) => line.includes('otp.review_locked'))).toBe(true);

    // Every other number is untouched by the review number's budget.
    const other = makeContext({}, false, 10);
    await expect(request(other.ctx, OTHER_PHONE)).resolves.toMatchObject({
      expiresInSeconds: 300,
    });
  });

  it('still issues a code while the budget has room', async () => {
    const { ctx, captured } = makeContext({}, false, 9);

    await request(ctx, REVIEW_PHONE);

    expect(captured.codeHash).toBe(hashOf(REVIEW_CODE, captured.challengeId));
  });

  it('is plain production behaviour when the switch is off, whatever else is set', async () => {
    const { ctx, captured } = makeContext({ GOOGLE_PLAY_REVIEW_ENABLED: 'false' });

    const result = await request(ctx, REVIEW_PHONE);

    expect(captured.codeHash).not.toBe(hashOf(REVIEW_CODE, captured.challengeId));
    expect(captured.providerNames).toEqual(['sms_gateway']);
    expect(result.devCode).toBeUndefined();
    expect(result.resendAfterSeconds).toBe(ctx.env.OTP_RESEND_COOLDOWN_SECONDS);
  });

  it('is off by default', async () => {
    const { ctx, captured } = makeContext({
      GOOGLE_PLAY_REVIEW_ENABLED: 'false',
      GOOGLE_PLAY_REVIEW_PHONE: '',
      GOOGLE_PLAY_REVIEW_OTP_CODE: '',
    });

    await request(ctx, REVIEW_PHONE);

    expect(ctx.env.GOOGLE_PLAY_REVIEW_ENABLED).toBe(false);
    expect(captured.providerNames).toEqual(['sms_gateway']);
  });
});

/** A context whose challenge lookup returns exactly this row. */
function contextWithChallenge(
  challenge: Record<string, unknown>,
  counters: string[] = [],
): AppContext {
  const env = loadApiEnv({
    APP_ENV: 'staging',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/jibli',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    OTP_HASH_PEPPER: PEPPER,
    OTP_PROVIDER: 'console',
    GOOGLE_PLAY_REVIEW_ENABLED: 'true',
    GOOGLE_PLAY_REVIEW_PHONE: REVIEW_PHONE,
    GOOGLE_PLAY_REVIEW_OTP_CODE: REVIEW_CODE,
  });

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => [challenge] }),
          limit: async () => [challenge],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({ returning: async () => [{ id: challenge.id }] }),
      }),
    }),
  };

  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    child: () => logger,
  };

  const redis = {
    incr: async (key: string) => {
      counters.push(`incr ${key}`);
      return 1;
    },
    expire: async (key: string, seconds: number) => {
      counters.push(`expire ${key} ${seconds}`);
      return 1;
    },
  };

  return { env, db, logger, redis } as unknown as AppContext;
}

function liveChallenge(phone: string, code: string) {
  const id = '0195e2a1-0000-7000-8000-00000000000b';
  return {
    id,
    phoneE164: phone,
    codeHash: hashShortCode(code, PEPPER, id),
    purpose: 'LOGIN',
    attemptCount: 0,
    maxAttempts: 5,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    consumedAt: null,
  };
}

describe('consumeOtpChallenge() with the review code', () => {
  it('verifies the review number against its own challenge', async () => {
    const ctx = contextWithChallenge(liveChallenge(REVIEW_PHONE, REVIEW_CODE));

    await expect(
      consumeOtpChallenge(ctx, { phoneE164: REVIEW_PHONE, code: REVIEW_CODE }),
    ).resolves.toBeUndefined();
  });

  it('cannot open another number: its challenge carries a code of its own', async () => {
    // The only way in is through the stored hash, and another number's
    // challenge was issued a random code — so the review code is just a wrong
    // guess, counted and refused like any other.
    const ctx = contextWithChallenge(liveChallenge(OTHER_PHONE, '4821'));

    await expect(
      consumeOtpChallenge(ctx, { phoneE164: OTHER_PHONE, code: REVIEW_CODE }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID' });
  });

  it("still refuses a wrong code for the review number, and spends the day's budget", async () => {
    const counters: string[] = [];
    const ctx = contextWithChallenge(liveChallenge(REVIEW_PHONE, REVIEW_CODE), counters);

    await expect(
      consumeOtpChallenge(ctx, { phoneE164: REVIEW_PHONE, code: '0000' }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID' });
    expect(counters).toContain('incr otp:review:failures');
    expect(counters).toContain('expire otp:review:failures 86400');
  });

  it("does not spend the review budget on another number's wrong guess", async () => {
    const counters: string[] = [];
    const ctx = contextWithChallenge(liveChallenge(OTHER_PHONE, '4821'), counters);

    await expect(
      consumeOtpChallenge(ctx, { phoneE164: OTHER_PHONE, code: '0000' }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID' });
    expect(counters).toEqual([]);
  });

  it('does not spend the budget on the right code', async () => {
    const counters: string[] = [];
    const ctx = contextWithChallenge(liveChallenge(REVIEW_PHONE, REVIEW_CODE), counters);

    await consumeOtpChallenge(ctx, { phoneE164: REVIEW_PHONE, code: REVIEW_CODE });
    expect(counters).toEqual([]);
  });

  it('still refuses an expired review challenge', async () => {
    const ctx = contextWithChallenge({
      ...liveChallenge(REVIEW_PHONE, REVIEW_CODE),
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      consumeOtpChallenge(ctx, { phoneE164: REVIEW_PHONE, code: REVIEW_CODE }),
    ).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('still counts attempts on the review challenge', async () => {
    const ctx = contextWithChallenge({
      ...liveChallenge(REVIEW_PHONE, REVIEW_CODE),
      attemptCount: 5,
    });

    await expect(
      consumeOtpChallenge(ctx, { phoneE164: REVIEW_PHONE, code: REVIEW_CODE }),
    ).rejects.toMatchObject({ code: 'OTP_MAX_ATTEMPTS' });
  });
});
