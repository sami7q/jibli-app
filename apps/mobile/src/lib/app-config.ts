import Constants from 'expo-constants';

/**
 * Reading `app.config.ts` `extra` at runtime — the only way to.
 *
 * The values in `extra` are not guaranteed to keep their type in a built app.
 * A key set to `null` in the config reached the first release APK as `{}`: the
 * embedded `assets/app.config` read `"sentryDsn": {}`, `"iosAppId": {}`. Expo
 * Go serves the config from the dev server and keeps the `null`, so every read
 * written as `if (!value)` worked there — and `{}` is truthy, so in the
 * installed app the same line decided a Sentry DSN existed and initialised the
 * native SDK with an object for an address, on the first line of startup. The
 * app hung on the splash and closed, only outside Expo Go.
 *
 * So nothing reads `extra` directly. A setting is a non-empty string or it is
 * absent, and this is the one place that decides which.
 */

function extra(): Record<string, unknown> {
  const value = Constants.expoConfig?.extra;
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** A configured string, or `null` for absent, empty, or the wrong type. */
export function configString(key: string): string | null {
  const value = extra()[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** A string inside a nested object, e.g. `configNested('google', 'webClientId')`. */
export function configNested(group: string, key: string): string | null {
  const container = extra()[group];
  if (!container || typeof container !== 'object') return null;
  const value = (container as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
