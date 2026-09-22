import { describe, expect, it } from 'vitest';
import { loadApiEnv } from '@jibli/config';
import { hashShortCode } from '@jibli/auth';
import type { AppContext } from '../lib/context.js';
import { consumeOtpChallenge, requestOtp } from './otp-service.js';

/**
 * The one number that can sign into a deployment with no SMS gateway.
 *
 * `OTP_PROVIDER=console` generates a real code and hands it to a provider that
 * deliberately never logs it, so for a while nobody could sign into the
 * deployed app at all — every screen opened, nothing could be finished.
 * `OTP_TEST_PHONES` opens the demo account and only the demo account, and the
 * assertions worth making are about what it does *not* change: another number
 * still gets a random code it cannot read, and nothing reaches a gateway.
 */

const PEPPER = 'p'.repeat(48);
const TEST_PHONE = '+9647712345678';
const OTHER_PHONE = '+9647801112233';

interface Captured {
  challengeId: string;
  codeHash: string;
  smsBodies: string[];
  providerNames: string[];
  /** Redis keys that were incremented or written, in order. */
  counters: string[];
  /** What the stored challenge said the code was issued for. */
  purpose: string;
}

/**
 * Enough of the context for `requestOtp`, and no more.
 *
 * The database calls are two chains and the Redis calls are counters; both are
 * stubbed rather than mocked so the test fails on a changed call shape instead
 * of silently passing.
 */
function makeContext(
  extraEnv: Record<string, string> = {},
  /** Pretend the cooldown is armed and the hourly counter is past the cap. */
  limitsExhausted = false,
): {
  ctx: AppContext;
  captured: Captured;
} {
  const captured: Captured = {
    challengeId: '',
    codeHash: '',
    smsBodies: [],
    providerNames: [],
    counters: [],
    purpose: '',
  };

  const env = loadApiEnv({
    APP_ENV: 'staging',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/jibli',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    OTP_HASH_PEPPER: PEPPER,
    OTP_PROVIDER: 'console',
    OTP_MOCK_CODE: '1234',
    ...extraEnv,
  });

  const db = {
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    insert: () => ({
      values: async (row: { id: string; codeHash: string; purpose: string }) => {
        captured.challengeId = row.id;
        captured.codeHash = row.codeHash;
        captured.purpose = row.purpose;
      },
    }),
  };

  const redis = {
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

  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    child: () => logger,
  };

  /** Stands in for a live aggregator: anything reaching it is a bug. */
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

const request = (ctx: AppContext, phone: string) =>
  requestOtp(ctx, { phoneE164: phone, ip: null, userAgent: null, requestId: 'r1' });

describe('requestOtp() with OTP_TEST_PHONES', () => {
  it('issues the fixed code to a listed number and hands it back', async () => {
    const { ctx, captured } = makeContext({ OTP_TEST_PHONES: TEST_PHONE });

    const result = await request(ctx, TEST_PHONE);

    expect(result.devCode).toBe('1234');
    // The challenge is stored exactly as any other: hashed, salted by its id.
    expect(captured.codeHash).toBe(hashShortCode('1234', PEPPER, captured.challengeId));
  });

  it('keeps every other number on a random code it cannot read', async () => {
    const { ctx, captured } = makeContext({ OTP_TEST_PHONES: TEST_PHONE });

    const result = await request(ctx, OTHER_PHONE);

    expect(result.devCode).toBeUndefined();
    expect(captured.codeHash).not.toBe(hashShortCode('1234', PEPPER, captured.challengeId));
  });

  it('never sends a listed number through the real gateway', async () => {
    const { ctx, captured } = makeContext({ OTP_TEST_PHONES: TEST_PHONE });

    await request(ctx, TEST_PHONE);

    // A fixed code carries nothing an SMS needs to deliver, and the number is
    // invented — a live aggregator would reject it and fail the one sign-in
    // the list exists to allow.
    expect(captured.providerNames).toEqual([]);
  });

  it('still routes an unlisted number to the configured provider', async () => {
    const { ctx, captured } = makeContext({ OTP_TEST_PHONES: TEST_PHONE });

    await request(ctx, OTHER_PHONE);

    expect(captured.providerNames).toEqual(['sms_gateway']);
  });

  it('is not refused by a cooldown or an exhausted hourly cap', async () => {
    const { ctx, captured } = makeContext({ OTP_TEST_PHONES: TEST_PHONE }, true);

    // The stub says the cooldown is armed and the counter is far past the cap.
    // For a number that sends no SMS, the limits guard a budget that does not
    // exist, and the only thing they can do is lock the reviewer out.
    await expect(request(ctx, TEST_PHONE)).resolves.toMatchObject({
      devCode: '1234',
      resendAfterSeconds: 0,
    });

    expect(captured.counters.some((c) => c.includes('otp:cooldown'))).toBe(false);
    expect(captured.counters.some((c) => c.includes('otp:phone:'))).toBe(false);
  });

  it('still counts the request against the caller IP', async () => {
    const { ctx, captured } = makeContext({ OTP_TEST_PHONES: TEST_PHONE });

    // That cap protects the server rather than an SMS budget, and the URL is
    // public — so it applies to a test number like any other.
    await requestOtp(ctx, {
      phoneE164: TEST_PHONE,
      ip: '10.0.0.1',
      userAgent: null,
      requestId: 'r2',
    }).catch(() => undefined);

    expect(captured.counters).toContain('incr otp:ip:h:10.0.0.1');
  });

  it('still refuses an unlisted number once its cooldown is armed', async () => {
    const { ctx } = makeContext({ OTP_TEST_PHONES: TEST_PHONE }, true);

    await expect(request(ctx, OTHER_PHONE)).rejects.toMatchObject({
      code: 'OTP_COOLDOWN_ACTIVE',
    });
  });

  it('changes nothing when the list is empty', async () => {
    const { ctx } = makeContext();

    const result = await request(ctx, TEST_PHONE);

    expect(result.devCode).toBeUndefined();
  });
});

/**
 * That a code is spendable only on the thing it was sent for.
 *
 * Customers can now register and reset a password with a code, not only sign
 * in — three flows, one delivery channel, and the codes are indistinguishable
 * to anyone holding the SMS. Without a purpose on the challenge, a code a
 * customer requested to *unlock* their account would also complete a
 * *registration* against their number, which turns "somebody glimpsed my
 * messages" from an account takeover risk into a number takeover.
 */

/** A context whose challenge lookup returns exactly this row. */
function contextWithChallenge(challenge: Record<string, unknown>): AppContext {
  const env = loadApiEnv({
    APP_ENV: 'staging',
    DATABASE_URL: 'postgres://user:pass@localhost:5432/jibli',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    OTP_HASH_PEPPER: PEPPER,
    OTP_PROVIDER: 'console',
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

  return { env, db, logger, redis: {} } as unknown as AppContext;
}

function liveChallenge(purpose: string, code = '4321') {
  const id = '0195e2a1-0000-7000-8000-00000000000a';
  return {
    id,
    phoneE164: OTHER_PHONE,
    codeHash: hashShortCode(code, PEPPER, id),
    purpose,
    attemptCount: 0,
    maxAttempts: 5,
    expiresAt: new Date(Date.now() + 5 * 60_000),
    consumedAt: null,
  };
}

describe('consumeOtpChallenge() purpose separation', () => {
  it('accepts a code spent on the purpose it was issued for', async () => {
    const ctx = contextWithChallenge(liveChallenge('PASSWORD_RESET'));

    await expect(
      consumeOtpChallenge(ctx, {
        phoneE164: OTHER_PHONE,
        code: '4321',
        purpose: 'PASSWORD_RESET',
      }),
    ).resolves.toBeUndefined();
  });

  it('refuses a reset code used to register', async () => {
    // The attack this closes: a code the owner requested to unlock their own
    // account must not be usable to claim the number instead.
    const ctx = contextWithChallenge(liveChallenge('PASSWORD_RESET'));

    await expect(
      consumeOtpChallenge(ctx, { phoneE164: OTHER_PHONE, code: '4321', purpose: 'REGISTER' }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID' });
  });

  it('refuses a sign-in code used to reset a password', async () => {
    const ctx = contextWithChallenge(liveChallenge('LOGIN'));

    await expect(
      consumeOtpChallenge(ctx, {
        phoneE164: OTHER_PHONE,
        code: '4321',
        purpose: 'PASSWORD_RESET',
      }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID' });
  });

  it('says only OTP_INVALID, never which purpose the code was for', async () => {
    /*
     * A distinct error would confirm that a reset was requested for the
     * number, which is exactly what somebody probing would like to learn.
     */
    const ctx = contextWithChallenge(liveChallenge('PASSWORD_RESET'));

    const error = await consumeOtpChallenge(ctx, {
      phoneE164: OTHER_PHONE,
      code: '4321',
      purpose: 'REGISTER',
    }).catch((caught: unknown) => caught);

    expect((error as { code: string }).code).toBe('OTP_INVALID');
    expect(JSON.stringify(error)).not.toContain('PASSWORD_RESET');
  });

  it('treats a challenge with no purpose as a sign-in, so old rows still work', async () => {
    // Every challenge written before this existed carries 'LOGIN' from the
    // column default. The original flow must be untouched by the new rule.
    const ctx = contextWithChallenge(liveChallenge('LOGIN'));

    await expect(
      consumeOtpChallenge(ctx, { phoneE164: OTHER_PHONE, code: '4321' }),
    ).resolves.toBeUndefined();
  });

  it('still rejects a wrong code for the right purpose', async () => {
    const ctx = contextWithChallenge(liveChallenge('REGISTER'));

    await expect(
      consumeOtpChallenge(ctx, { phoneE164: OTHER_PHONE, code: '9999', purpose: 'REGISTER' }),
    ).rejects.toMatchObject({ code: 'OTP_INVALID' });
  });
});

describe('requestOtp() records what the code is for', () => {
  it.each(['REGISTER', 'PASSWORD_RESET'] as const)('stores purpose %s', async (purpose) => {
    const { ctx, captured } = makeContext();

    await requestOtp(ctx, {
      phoneE164: OTHER_PHONE,
      ip: null,
      userAgent: null,
      requestId: 'r1',
      purpose,
    });

    expect(captured.purpose).toBe(purpose);
  });

  it('defaults to LOGIN, so the original sign-in is unchanged', async () => {
    const { ctx, captured } = makeContext();

    await request(ctx, OTHER_PHONE);

    expect(captured.purpose).toBe('LOGIN');
  });
});
