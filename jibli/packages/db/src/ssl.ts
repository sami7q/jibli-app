/**
 * Whether this connection needs TLS.
 *
 * Every managed Postgres — Neon, Supabase, Railway, RDS — requires TLS and
 * refuses a plaintext connection outright. A local container does not offer it
 * at all, so neither "always on" nor "always off" works.
 *
 * The rule: honour an explicit `sslmode` in the URL, then `DATABASE_SSL`, and
 * otherwise infer it from the host. Inferring means a deployment that forgets
 * the flag still connects rather than failing at the first query with an error
 * that names TLS but reads like a credentials problem.
 */
export function shouldUseSsl(connectionString: string, explicit?: string): boolean {
  const url = connectionString.toLowerCase();

  if (url.includes('sslmode=disable')) return false;
  if (url.includes('sslmode=require') || url.includes('sslmode=verify')) return true;

  if (explicit !== undefined && explicit !== '') {
    return explicit === 'true' || explicit === '1';
  }

  // Loopback is the only place a plaintext connection is normal.
  return !/@(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal|postgres|db)[:/]/.test(url);
}
