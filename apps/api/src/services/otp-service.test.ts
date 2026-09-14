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
}

/**
 * Enough of the context for `requestOtp`, and no more.
 *
 * The database calls are two chains and the Redis calls are counters; both are
 * stubbed rather than mocked so the test fails on a changed call shape instead
 * of silently passing.
 */
function makeContext(extraEnv: Record<string, string> = {}): {
  ctx: AppContext;
  captured: Captured;
} {
  const captured: Captured = {
    challengeId: '',
    codeHash: '',
    smsBodies: [],
    providerNames: [],
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
    ttl: async () => -2,
    incr: async () => 1,
    expire: async () => 1,
    set: async () => 'OK',
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

  it('changes nothing when the list is empty', async () => {
    const { ctx } = makeContext();

    const result = await request(ctx, TEST_PHONE);

    expect(result.devCode).toBeUndefined();
  });
});
