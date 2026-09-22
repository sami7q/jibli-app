import { fileURLToPath } from 'node:url';

/**
 * Shared Next.js configuration for the two portals.
 *
 * Admin and Restaurant had byte-identical configs, which is exactly how a
 * security header ends up on one portal and not the other. One module, imported
 * by both, makes that impossible.
 */

/**
 * The monorepo root.
 *
 * Next infers it by walking up for a lockfile, and picks the wrong one when
 * another lockfile exists higher in the filesystem — on a developer machine
 * that is often a stray package-lock.json in the home directory. Stating it
 * removes the guess, and with it a warning that differs between machines and
 * CI.
 */
const workspaceRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * Refuse to build a portal that does not know where its API is.
 *
 * `src/lib/api.ts` falls back to `http://localhost:4000` when
 * `NEXT_PUBLIC_API_URL` is unset. That is right on a developer's machine and
 * catastrophic anywhere else: a portal deployed without the variable builds
 * cleanly, serves cleanly, and every screen in it fails — because the browser
 * is asking *its own* localhost for the API. There is no error that says so;
 * the network tab shows a connection refused and the UI shows empty states.
 *
 * `NEXT_PUBLIC_*` is inlined at build time, so a missing variable cannot be
 * repaired by restarting the deployment with it set — the wrong value is
 * already compiled into the bundle. That is what makes this worth failing a
 * build over rather than checking at runtime.
 *
 * Only for a production build. `next dev` and `next build` locally are exactly
 * the case the fallback exists for.
 */
function assertApiOriginConfigured() {
  const isProductionBuild =
    process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-development-server';

  if (!isProductionBuild) return;

  // A same-origin proxy is a valid answer: there is no separate origin to name.
  if (process.env.NEXT_PUBLIC_API_PROXY === '1') return;
  if (process.env.NEXT_PUBLIC_API_URL) return;

  throw new Error(
    'NEXT_PUBLIC_API_URL is not set for this production build.\n' +
      'The portal would fall back to http://localhost:4000, which in a browser ' +
      'means the visitor’s own machine — every request fails and every screen ' +
      'renders empty.\n' +
      'Set NEXT_PUBLIC_API_URL in the Vercel project’s environment variables, ' +
      'or set NEXT_PUBLIC_API_PROXY=1 if the API is served from this origin.',
  );
}

assertApiOriginConfigured();

/** @type {import('next').NextConfig} */
export const portalNextConfig = {
  reactStrictMode: true,

  outputFileTracingRoot: workspaceRoot,

  // Workspace packages ship TypeScript source; Next compiles them itself.
  transpilePackages: ['@jibli/ui-web', '@jibli/contracts', '@jibli/money', '@jibli/validation'],

  poweredByHeader: false,

  webpack(config) {
    /*
     * The workspace packages are ESM TypeScript, so their internal imports are
     * written as `./errors.js` — the specifier that will exist after `tsc`
     * emits. Webpack resolves that literally and finds nothing, because on disk
     * the file is still `errors.ts`.
     *
     * `extensionAlias` teaches it to try the TypeScript source for a `.js`
     * specifier. Without it, every workspace package with more than one file
     * fails to build, and the error names the missing `.js` rather than the
     * cause.
     */
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },

  /**
   * Proxy the API through this origin.
   *
   * On Vercel the portals sit on *.vercel.app and the API on another host
   * entirely. A refresh cookie set by that host is third-party to the portal
   * and modern browsers simply do not send it, so every session would die at
   * page load.
   *
   * Rewriting /api/* through Next makes the browser talk only to its own
   * origin: the cookie is first-party, CORS never enters the picture, and the
   * CSP can stay at `connect-src 'self'`.
   *
   * The WebSocket is not proxied — Vercel does not forward upgrade requests —
   * and does not need to be: it authenticates with the access token in the
   * query string, not with the cookie, so it connects to the API directly.
   */
  async rewrites() {
    const origin = process.env.API_ORIGIN;
    if (!origin) return [];

    return [{ source: '/api/:path*', destination: `${origin.replace(/\/$/, '')}/api/:path*` }];
  },

  async headers() {
    /*
     * Content-Security-Policy.
     *
     * The portals had every other security header and not this one, which is
     * the header that actually contains an injected script. It is built here
     * from the configured API origin so a deployment pointing at a different
     * API does not silently have its own XHR blocked.
     *
     * `'unsafe-inline'` on script-src is the one concession: Next's App Router
     * emits an inline bootstrap script, and removing it needs a per-request
     * nonce, which in turn forces every route to render dynamically. These
     * pages already send `Cache-Control: private, no-store`, so that would cost
     * little — but the XSS surface here is small and worth stating plainly:
     * no page uses dangerouslySetInnerHTML, and all rendered values come from
     * our own API through React's escaping. What the policy still buys, even
     * with that concession, is that an attacker cannot load script from another
     * origin, cannot exfiltrate to one (connect-src), and cannot frame the
     * portal (frame-ancestors).
     */
    const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    const wsOrigin = apiOrigin.replace(/^http/, 'ws');
    /*
     * When the API is proxied through this origin, XHR is same-origin and only
     * the WebSocket needs naming. Without the proxy, both do.
     */
    const httpConnect = process.env.API_ORIGIN ? '' : ` ${apiOrigin}`;

    /*
     * `'unsafe-eval'`, in development only.
     *
     * `next dev` ships React Refresh, and its runtime evaluates a string —
     * which this policy forbids. The result was not a warning in the console
     * and a working page: the client bundle threw on load, React never
     * hydrated, and both portals served server-rendered HTML with no
     * interactivity at all. Every field accepted text and no button ever
     * enabled, because nothing was listening.
     *
     * It survived because it cannot happen in production. `next build` emits
     * no Refresh runtime, so `pnpm build` passed, the deployed portals were
     * fine, and only local development was broken — which is the shape of bug
     * that lasts longest, since the thing that would catch it is the thing
     * that is broken.
     *
     * Gated on NODE_ENV so the production policy is byte-for-byte what it was.
     */
    const devEval = process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '';

    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${devEval}`,
      // React sets inline `style` attributes. No external stylesheet: the font
      // is self-hosted by next/font, so no third-party origin is allowed here.
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "img-src 'self' data: blob:",
      `connect-src 'self'${httpConnect} ${wsOrigin}`,
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; ');

    return [
      {
        // Security headers (plan §82). Finance pages carry no third-party scripts.
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Redundant with frame-ancestors, kept for browsers that predate it.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          {
            key: 'Permissions-Policy',
            value:
              'geolocation=(), microphone=(), camera=(), payment=(), usb=(), interest-cohort=()',
          },
          // Isolates the portal's browsing context group from anything it opens.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
        ],
      },
      {
        // Authenticated portal data must never enter a shared cache (plan §80).
        source: '/((?!_next/static|_next/image|favicon.ico).*)',
        headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }],
      },
    ];
  },
};
