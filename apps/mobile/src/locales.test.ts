import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The guard on `locales/*.json`.
 *
 * Expo applies a top-level key in these files to both platforms. Flat iOS keys
 * reached Android as `res/values-b+<lang>/strings.xml` entries with no default
 * counterpart, and release lint failed the build with six ExtraTranslation
 * errors — after ten minutes in the build queue, with nothing to see locally.
 * This test fails in a second instead.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, '../locales');
const files = readdirSync(dir).filter((name) => name.endsWith('.json'));

/** Android keys that exist in the default strings.xml Expo generates. */
const ANDROID_KEYS_WITH_A_DEFAULT = new Set(['app_name']);

describe('locale files', () => {
  it('exist', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s nests every key under ios or android', (file) => {
    const locale = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(Object.keys(locale).filter((key) => key !== 'ios' && key !== 'android')).toEqual([]);
  });

  it.each(files)('%s only translates Android strings that have a default', (file) => {
    const locale = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as {
      android?: Record<string, string>;
    };
    const extra = Object.keys(locale.android ?? {}).filter(
      (key) => !ANDROID_KEYS_WITH_A_DEFAULT.has(key),
    );
    expect(extra).toEqual([]);
  });
});
