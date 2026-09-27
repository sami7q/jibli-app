import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The shape a release APK actually embedded: every `null` in app.config.ts
 * arrived as `{}`. These are the values the readers must refuse.
 */
const extra: Record<string, unknown> = {};

vi.mock('expo-constants', () => ({
  default: {
    get expoConfig() {
      return { extra };
    },
  },
}));

const { configNested, configString } = await import('./app-config');

describe('reading app config extra', () => {
  beforeEach(() => {
    for (const key of Object.keys(extra)) delete extra[key];
  });

  it('treats the {} a release build embeds for null as absent', () => {
    extra.sentryDsn = {};
    extra.iosAppId = {};
    expect(configString('sentryDsn')).toBeNull();
    expect(configString('iosAppId')).toBeNull();
  });

  it('treats missing, null and empty as absent', () => {
    extra.a = null;
    extra.b = '';
    extra.c = '   ';
    expect(configString('missing')).toBeNull();
    expect(configString('a')).toBeNull();
    expect(configString('b')).toBeNull();
    expect(configString('c')).toBeNull();
  });

  it('returns a real string', () => {
    extra.apiUrl = 'https://jibli-api.onrender.com';
    expect(configString('apiUrl')).toBe('https://jibli-api.onrender.com');
  });

  it('reads nested strings and refuses nested non-strings', () => {
    extra.google = { webClientId: 'abc', androidClientId: {} };
    expect(configNested('google', 'webClientId')).toBe('abc');
    expect(configNested('google', 'androidClientId')).toBeNull();
    expect(configNested('missing', 'x')).toBeNull();
  });
});
