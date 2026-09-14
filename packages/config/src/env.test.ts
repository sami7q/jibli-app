import { describe, expect, it } from 'vitest';
import { loadApiEnv, parseCsv } from './env.js';

/**
 * The environment is the only place where a testing shortcut can turn into a
 * production hole, so the guards that stop it are worth a test of their own.
 */

const secret = (seed: string) => seed.repeat(40).slice(0, 48);

/** A minimal environment the schema accepts, to vary one key at a time. */
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

describe('OTP test numbers', () => {
  it('are accepted outside production', () => {
    const env = loadApiEnv(
      baseEnv({ APP_ENV: 'staging', OTP_TEST_PHONES: '+9647712345678,+9647800000000' }),
    );
    expect(parseCsv(env.OTP_TEST_PHONES)).toEqual(['+9647712345678', '+9647800000000']);
  });

  it('are refused in production', () => {
    expect(() =>
      loadApiEnv(
        baseEnv({
          APP_ENV: 'production',
          OTP_PROVIDER: 'sms_gateway',
          SMS_GATEWAY_URL: 'https://sms.example.com/send',
          SMS_GATEWAY_API_KEY: 'key',
          PUSH_PROVIDER: 'expo',
          DATABASE_SSL: 'true',
          CORS_ALLOWED_ORIGINS: 'https://admin.jibli.iq',
          OTP_TEST_PHONES: '+9647712345678',
        }),
      ),
    ).toThrow(/production must not carry fixed-code test numbers/);
  });

  it('are absent by default', () => {
    expect(loadApiEnv(baseEnv()).OTP_TEST_PHONES).toBeUndefined();
  });
});

describe('production guards', () => {
  it('still refuse a mock OTP provider', () => {
    expect(() =>
      loadApiEnv(
        baseEnv({
          APP_ENV: 'production',
          OTP_PROVIDER: 'mock',
          PUSH_PROVIDER: 'expo',
          DATABASE_SSL: 'true',
          CORS_ALLOWED_ORIGINS: 'https://admin.jibli.iq',
        }),
      ),
    ).toThrow(/production requires a real OTP provider/);
  });
});
