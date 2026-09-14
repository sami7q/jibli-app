import { describe, expect, it } from 'vitest';
import { loadApiEnv } from '@jibli/config';
import { hashShortCode } from '@jibli/auth';
import type { AppContext } from '../lib/context.js';
import { requestOtp } from './otp-service.js';

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
      values: async (row: { id: string; codeHash: string }) => {
        captured.challengeId = row.id;
        captured.codeHash = row.codeHash;
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
