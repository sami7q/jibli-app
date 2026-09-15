import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDotEnv } from './dotenv.js';

/**
 * The bug these cover: pnpm runs a package's script with that package's own
 * directory as the working directory, so a loader that resolved `.env` against
 * the cwd and stopped there never found the one file the repository has. The
 * failure surfaced as "DATABASE_URL must be set" from a machine whose `.env`
 * defines it.
 */

const created: string[] = [];
const originalCwd = process.cwd();

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'jibli-dotenv-'));
  created.push(root);
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  mkdirSync(join(root, 'packages', 'db'), { recursive: true });
  return root;
}

afterEach(() => {
  process.chdir(originalCwd);
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('loadDotEnv', () => {
  it('finds the repository .env from inside a package', () => {
    const root = workspace();
    writeFileSync(join(root, '.env'), 'DATABASE_URL=postgres://found\n');
    process.chdir(join(root, 'packages', 'db'));

    const env: NodeJS.ProcessEnv = {};
    const result = loadDotEnv({ env });

    expect(result.loaded).toBe(1);
    expect(env.DATABASE_URL).toBe('postgres://found');
  });

  it('prefers a package-local .env over the root one', () => {
    const root = workspace();
    writeFileSync(join(root, '.env'), 'WHICH=root\n');
    writeFileSync(join(root, 'packages', 'db', '.env'), 'WHICH=package\n');
    process.chdir(join(root, 'packages', 'db'));

    const env: NodeJS.ProcessEnv = {};
    loadDotEnv({ env });

    expect(env.WHICH).toBe('package');
  });

  it('stops at the workspace root rather than reaching a home directory', () => {
    const root = workspace();
    // A stray .env above the project must never be picked up.
    writeFileSync(join(root, '..', 'should-not-be-read.env'), 'LEAKED=yes\n');
    created.push(join(root, '..', 'should-not-be-read.env'));
    process.chdir(join(root, 'packages', 'db'));

    const env: NodeJS.ProcessEnv = {};
    const result = loadDotEnv({ env });

    expect(result.path).toBeNull();
    expect(env.LEAKED).toBeUndefined();
  });

  it('never overwrites a real environment variable', () => {
    const root = workspace();
    writeFileSync(join(root, '.env'), 'DATABASE_URL=postgres://from-file\n');
    process.chdir(root);

    const env: NodeJS.ProcessEnv = { DATABASE_URL: 'postgres://from-shell' };
    loadDotEnv({ env });

    expect(env.DATABASE_URL).toBe('postgres://from-shell');
  });

  it('reads nothing under NODE_ENV=production', () => {
    const root = workspace();
    writeFileSync(join(root, '.env'), 'DATABASE_URL=postgres://from-file\n');
    process.chdir(root);

    const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
    const result = loadDotEnv({ env });

    expect(result.path).toBeNull();
    expect(env.DATABASE_URL).toBeUndefined();
  });
});
