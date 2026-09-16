import { fileURLToPath } from 'node:url';

/**
 * The public legal site.
 *
 * Deliberately not `portalNextConfig`, which the two portals share. That
 * config is written for pages behind a session: it sends
 * `Cache-Control: private, no-store` on everything and proxies `/api/*` to the
 * backend. Both are wrong here. These three pages are the opposite kind of
 * thing — public, cacheable, and required to load for a store reviewer who has
 * never signed into anything, on a link they will open exactly once.
 *
 * It also has no API origin at all. Nothing on this site fetches; the whole
 * point is that a privacy policy cannot be down because the database is.
 */
/*
 * The monorepo root, counted from *this* file.
 *
 * `config/next-portal.mjs` — which the two portals share — writes `'..'`,
 * because it sits one level down. This file sits two, and copying the literal
 * across pointed the tracing root at `apps/` instead of the repository. Next
 * then emitted file references relative to a root that does not contain
 * `node_modules`, the build passed every local check, and Vercel failed at the
 * very last step with `Cannot find module
 * 'next/dist/compiled/next-server/server.runtime.prod.js'` and a require stack
 * naming a path that never existed: `/vercel/path0/legal/noop.js`.
 *
 * The depth is the whole content of this line. Moving this file changes it.
 */
const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  outputFileTracingRoot: workspaceRoot,
  poweredByHeader: false,

  async headers() {
    /*
     * No `connect-src` beyond self and no external font or script origin:
     * Cairo and the mono face are self-hosted by `next/font` at build time, and
     * the only client component on the site is the three-link tab bar.
     */
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; ');

    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          /*
           * Cacheable, unlike the portals.
           *
           * A policy page that answers in 20ms from an edge cache is one a
           * reviewer never times out on — and the memory of this project is
           * that a sleeping free instance is the failure mode that looks like
           * a broken app. Nothing here is per-visitor, so there is nothing to
           * keep out of a shared cache.
           */
          { key: 'Cache-Control', value: 'public, max-age=0, s-maxage=3600, must-revalidate' },
        ],
      },
    ];
  },
};

export default config;
