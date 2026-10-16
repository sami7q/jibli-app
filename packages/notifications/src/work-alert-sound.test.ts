import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WORK_ALERT_SOUND } from './index.js';

/**
 * The push names a sound; the app must ship a file by that name, or iOS plays
 * nothing and a shop's new order arrives in silence.
 */
describe('WORK_ALERT_SOUND', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const asset = path.resolve(here, '../../../apps/mobile/assets/sounds', WORK_ALERT_SOUND);

  it('is a file the mobile app bundles', () => {
    expect(existsSync(asset)).toBe(true);
  });

  it('is a valid Android resource name (lowercase, digits, underscores)', () => {
    expect(WORK_ALERT_SOUND.replace(/\.wav$/, '')).toMatch(/^[a-z][a-z0-9_]*$/);
  });
});
