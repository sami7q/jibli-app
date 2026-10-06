import { describe, expect, it } from 'vitest';
import { loadApiEnv } from './env.js';

/**
 * The Google Play review switch fails closed.
 *
 * Switched on without both halves it refuses to boot rather than quietly doing
 * nothing — or quietly accepting a code nobody chose. Left off, the two values
 * are inert. And unlike the test-number list it is allowed in production,
 * because production is where the review happens.
 */

const secret = (seed: string) => seed.repeat(40).slice(0, 48);

function baseEnv(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/jibli',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: secret('a'),
    JWT_REFRESH_SECRET: secret('b'),
    OTP_HASH_PEPPER: secret('c'),
    ...overrides,
  };
}

const productionEnv = (overrides: Record<string, string> = {}) =>
  baseEnv({
    APP_ENV: 'production',
    OTP_PROVIDER: 'sms_gateway',
    SMS_GATEWAY_URL: 'https://api.otpiq.com/api/sms',
    SMS_GATEWAY_API_KEY: 'key',
    PUSH_PROVIDER: 'expo',
    DATABASE_SSL: 'true',
    CORS_ALLOWED_ORIGINS: 'https://admin.jibli.iq',
    ...overrides,
  });

const review = {
  GOOGLE_PLAY_REVIEW_ENABLED: 'true',
  GOOGLE_PLAY_REVIEW_PHONE: '+9647700001234',
  GOOGLE_PLAY_REVIEW_OTP_CODE: '7391',
};

describe('GOOGLE_PLAY_REVIEW_*', () => {
  it('is off by default and the values are absent', () => {
    const env = loadApiEnv(baseEnv());
    expect(env.GOOGLE_PLAY_REVIEW_ENABLED).toBe(false);
    expect(env.GOOGLE_PLAY_REVIEW_PHONE).toBeUndefined();
    expect(env.GOOGLE_PLAY_REVIEW_OTP_CODE).toBeUndefined();
  });

  it('is accepted when all three are set', () => {
    const env = loadApiEnv(baseEnv({ APP_ENV: 'staging', ...review }));
    expect(env.GOOGLE_PLAY_REVIEW_ENABLED).toBe(true);
    expect(env.GOOGLE_PLAY_REVIEW_PHONE).toBe('+9647700001234');
    expect(env.GOOGLE_PLAY_REVIEW_OTP_CODE).toBe('7391');
  });

  it('is accepted in production, unlike the test-number list', () => {
    expect(() => loadApiEnv(productionEnv(review))).not.toThrow();
    expect(() => loadApiEnv(productionEnv({ OTP_TEST_PHONES: '+9647712345678' }))).toThrow(
      /production must not carry fixed-code test numbers/,
    );
  });

  it('refuses the switch without a phone', () => {
    expect(() =>
      loadApiEnv(
        baseEnv({ GOOGLE_PLAY_REVIEW_ENABLED: 'true', GOOGLE_PLAY_REVIEW_OTP_CODE: '7391' }),
      ),
    ).toThrow(/requires both GOOGLE_PLAY_REVIEW_PHONE and GOOGLE_PLAY_REVIEW_OTP_CODE/);
  });

  it('refuses the switch without a code', () => {
    expect(() =>
      loadApiEnv(
        baseEnv({ GOOGLE_PLAY_REVIEW_ENABLED: 'true', GOOGLE_PLAY_REVIEW_PHONE: '+9647700001234' }),
      ),
    ).toThrow(/requires both GOOGLE_PLAY_REVIEW_PHONE and GOOGLE_PLAY_REVIEW_OTP_CODE/);
  });

  it('refuses a code that is not OTP_LENGTH long', () => {
    expect(() => loadApiEnv(baseEnv({ ...review, GOOGLE_PLAY_REVIEW_OTP_CODE: '73915' }))).toThrow(
      /must be exactly OTP_LENGTH \(4\) digits/,
    );
    expect(() =>
      loadApiEnv(baseEnv({ ...review, OTP_LENGTH: '6', GOOGLE_PLAY_REVIEW_OTP_CODE: '739154' })),
    ).not.toThrow();
  });

  it('refuses a guessable code', () => {
    expect(() => loadApiEnv(baseEnv({ ...review, GOOGLE_PLAY_REVIEW_OTP_CODE: '0000' }))).toThrow(
      /must not be OTP_MOCK_CODE or a single repeated digit/,
    );
    expect(() => loadApiEnv(baseEnv({ ...review, GOOGLE_PLAY_REVIEW_OTP_CODE: '7777' }))).toThrow(
      /must not be OTP_MOCK_CODE or a single repeated digit/,
    );
    expect(() => loadApiEnv(baseEnv({ ...review, OTP_MOCK_CODE: '7391' }))).toThrow(
      /must not be OTP_MOCK_CODE/,
    );
  });

  it('refuses a number that is not an Iraqi mobile', () => {
    expect(() =>
      loadApiEnv(baseEnv({ ...review, GOOGLE_PLAY_REVIEW_PHONE: '+14155550100' })),
    ).toThrow(/Iraqi mobile/);
    expect(() =>
      loadApiEnv(baseEnv({ ...review, GOOGLE_PLAY_REVIEW_PHONE: '07700001234' })),
    ).toThrow(/Iraqi mobile/);
  });

  it('leaves the values inert while the switch is off', () => {
    const env = loadApiEnv(
      baseEnv({
        GOOGLE_PLAY_REVIEW_ENABLED: 'false',
        GOOGLE_PLAY_REVIEW_PHONE: '+9647700001234',
        GOOGLE_PLAY_REVIEW_OTP_CODE: '7391',
      }),
    );
    expect(env.GOOGLE_PLAY_REVIEW_ENABLED).toBe(false);
    // Half-set values are tolerated too — they do nothing until switched on.
    expect(() => loadApiEnv(baseEnv({ GOOGLE_PLAY_REVIEW_OTP_CODE: '7391' }))).not.toThrow();
  });
});
