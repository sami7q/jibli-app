import { describe, expect, it } from 'vitest';
import { shouldUseSsl } from './ssl.js';

/**
 * Getting this wrong does not degrade gracefully: a managed Postgres refuses a
 * plaintext connection with an error that reads like bad credentials, and a
 * local container refuses a TLS handshake it cannot perform. Either way the
 * deployment fails at the first query, so the decision is pinned down here.
 */
describe('shouldUseSsl()', () => {
  it('leaves a local connection plaintext', () => {
    expect(shouldUseSsl('postgresql://u:p@localhost:5432/jibli')).toBe(false);
    expect(shouldUseSsl('postgresql://u:p@127.0.0.1:5432/jibli')).toBe(false);
    expect(shouldUseSsl('postgresql://u:p@[::1]:5432/jibli')).toBe(false);
  });

  it('treats compose service names as local', () => {
    // docker-compose resolves `db` and `postgres` on an internal network that
    // never leaves the host.
    expect(shouldUseSsl('postgresql://u:p@db:5432/jibli')).toBe(false);
    expect(shouldUseSsl('postgresql://u:p@postgres:5432/jibli')).toBe(false);
    expect(shouldUseSsl('postgresql://u:p@host.docker.internal:5432/jibli')).toBe(false);
  });

  it('turns TLS on for a managed host, with no flag set', () => {
    expect(shouldUseSsl('postgresql://u:p@ep-cool-forest.neon.tech/jibli')).toBe(true);
    expect(shouldUseSsl('postgresql://u:p@aws-0-eu.pooler.supabase.com:5432/postgres')).toBe(true);
    expect(shouldUseSsl('postgresql://u:p@containers.railway.app:6543/railway')).toBe(true);
  });

  it('honours sslmode in the URL above everything else', () => {
    expect(shouldUseSsl('postgresql://u:p@neon.tech/db?sslmode=disable')).toBe(false);
    expect(shouldUseSsl('postgresql://u:p@localhost/db?sslmode=require')).toBe(true);
    expect(shouldUseSsl('postgresql://u:p@localhost/db?sslmode=verify-full')).toBe(true);
  });

  it('honours an explicit DATABASE_SSL over the host guess', () => {
    expect(shouldUseSsl('postgresql://u:p@localhost/db', 'true')).toBe(true);
    expect(shouldUseSsl('postgresql://u:p@neon.tech/db', 'false')).toBe(false);
    expect(shouldUseSsl('postgresql://u:p@neon.tech/db', '1')).toBe(true);
  });

  it('falls back to the host guess when the flag is empty', () => {
    // An unset variable arrives as '' through most process managers, which must
    // not read as "false".
    expect(shouldUseSsl('postgresql://u:p@neon.tech/db', '')).toBe(true);
    expect(shouldUseSsl('postgresql://u:p@localhost/db', '')).toBe(false);
  });

  it('is case-insensitive about the host and the mode', () => {
    expect(shouldUseSsl('postgresql://u:p@LOCALHOST:5432/db')).toBe(false);
    expect(shouldUseSsl('postgresql://u:p@neon.tech/db?SSLMODE=DISABLE')).toBe(false);
  });
});
