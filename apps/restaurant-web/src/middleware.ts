import { createPortalMiddleware } from '@jibli/ui-web/middleware';

/**
 * Route guard. Runs before any page renders, so a signed-out visitor is sent
 * to the sign-in form instead of reaching a screen that can only tell them it
 * has nothing to show.
 *
 * The cookie name must match SESSION_COOKIE_NAME on the API. It is read from
 * the environment so a deployment that renames it does not silently lock
 * everyone out.
 */
export default createPortalMiddleware({
  cookieName: process.env.NEXT_PUBLIC_SESSION_COOKIE_NAME ?? 'jibli_session',
  /*
   * `/apply` is for a restaurant that has no account and is asking for one.
   * Left out of this list it would be guarded like the rest of the portal and
   * redirect the exact visitor it exists for to a sign-in form they cannot use.
   */
  /*
   * `/driver/login` is the couriers' door. It sits under the same deployment
   * because a driver portal is three screens and its own Vercel project would
   * be three screens with a build pipeline attached — but it is a different
   * audience with a different session, so it needs its own public path.
   */
  publicPaths: ['/login', '/change-password', '/apply', '/driver/login'],
});

/*
 * The matcher MUST be a literal here.
 *
 * Next resolves `config.matcher` by reading the source at build time, not by
 * evaluating it. An imported constant resolves to nothing and Next falls back
 * to `/:path*` — matching every request, including `/api`, which would send
 * the sign-in POST to the sign-in page and make login impossible. That failure
 * is silent; the only evidence is `originalSource` in the build manifest.
 *
 * Kept identical to PORTAL_MIDDLEWARE_MATCHER in @jibli/ui-web/middleware.
 */
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
