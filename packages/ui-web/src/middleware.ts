import { NextResponse, type NextRequest } from 'next/server';

/**
 * The portal route guard (plan §77, §80, §85).
 *
 * This runs at the edge, before any page renders. Without it every page has to
 * discover for itself that there is no session, which is how twenty screens
 * ended up each rendering their own "please sign in" dead end — a message with
 * nowhere to go.
 *
 * **What this is and is not.** It checks that a session cookie is *present*.
 * It does not and cannot validate it: the cookie holds an opaque refresh token
 * whose hash lives in PostgreSQL, and the edge has no database. A forged or
 * expired cookie gets past this gate and is then rejected by the API on the
 * first call, which is the check that actually matters.
 *
 * So this is a redirect, not a security boundary. Its job is to send a
 * signed-out visitor somewhere useful instead of showing them an empty shell.
 * Every endpoint behind it still authenticates independently.
 */

export interface PortalMiddlewareOptions {
  /** Cookie the API sets on sign-in. Must match SESSION_COOKIE_NAME. */
  readonly cookieName?: string;
  /**
   * Reachable without a session.
   *
   * Distinct from `signedOutOnlyPaths`: /change-password is reachable while
   * signed in — it is the *only* screen a user forced to replace an issued
   * password can use — whereas /login must push a signed-in visitor away.
   */
  readonly publicPaths?: readonly string[];
  /** Redirected inward when a session already exists. Normally just /login. */
  readonly signedOutOnlyPaths?: readonly string[];
}

const DEFAULT_PUBLIC_PATHS = ['/login', '/change-password'] as const;
const DEFAULT_SIGNED_OUT_ONLY = ['/login'] as const;

export function createPortalMiddleware(options: PortalMiddlewareOptions = {}) {
  const cookieName = options.cookieName ?? 'jibli_session';
  const publicPaths = options.publicPaths ?? DEFAULT_PUBLIC_PATHS;
  const signedOutOnly = options.signedOutOnlyPaths ?? DEFAULT_SIGNED_OUT_ONLY;

  return function middleware(request: NextRequest): NextResponse {
    const { pathname, search } = request.nextUrl;

    /*
     * Never touch the API path, even if the matcher lets it through.
     *
     * `/api/*` is rewritten straight to the backend, which authenticates for
     * itself and must be able to answer 401. Redirecting it would send the
     * sign-in POST to the sign-in page — login would be impossible, and the
     * symptom is a form that silently does nothing.
     *
     * The matcher below is supposed to exclude this. It is repeated here
     * because Next only honours a matcher it can read statically, so a small
     * refactor can quietly widen it back to everything.
     */
    if (pathname.startsWith('/api/') || pathname === '/api') {
      return NextResponse.next();
    }

    const matches = (paths: readonly string[]) =>
      paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));

    const isPublic = matches(publicPaths);
    const hasSession = request.cookies.has(cookieName);

    /*
     * Already signed in and sitting on /login: send them inside. Leaving the
     * sign-in form reachable with a live session invites people to re-enter a
     * password they did not need to, which trains exactly the habit phishing
     * relies on.
     */
    if (matches(signedOutOnly) && hasSession) {
      const next = request.nextUrl.searchParams.get('next');
      const destination = new URL(safeReturnPath(next), request.url);
      return NextResponse.redirect(destination);
    }

    if (isPublic || hasSession) {
      return NextResponse.next();
    }

    /*
     * Remember where they were headed so signing in lands them there rather
     * than on the dashboard. The value is validated on the way back out —
     * see safeReturnPath — because a `next` parameter is an open-redirect
     * vector if it is ever trusted as given.
     */
    const login = new URL('/login', request.url);
    if (pathname !== '/') {
      login.searchParams.set('next', `${pathname}${search}`);
    }

    const response = NextResponse.redirect(login);
    // A redirect away from an authenticated area must never be cached: a shared
    // cache could then serve it to someone who *is* signed in.
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };
}

/**
 * Reduce a `next` parameter to a safe same-origin path.
 *
 * Anything that could leave this origin becomes "/". The cases that matter:
 *
 *   https://evil.test        — absolute URL
 *   //evil.test              — protocol-relative, still off-origin
 *   /\evil.test              — backslash, which some parsers normalise to //
 *   javascript:alert(1)      — scheme that executes
 *
 * An open redirect on a login page is worth real money to a phisher: the link
 * genuinely starts on your domain, which is the part a careful user checks.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value) return '/';
  // Must be a single leading slash followed by something that is not a slash
  // or a backslash.
  if (!/^\/(?![/\\])/.test(value)) return '/';
  if (value.includes('\\')) return '/';
  // Control characters can be used to smuggle a newline into a Location header.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001F\u007F]/.test(value)) return '/';
  return value;
}

/**
 * Paths the middleware should never run on.
 *
 * Static assets and the Next internals are excluded so a signed-out visitor
 * still gets CSS and fonts on the login page itself. `/api` is excluded because
 * it is rewritten straight to the API, which does its own authentication and
 * must be able to answer 401 rather than be redirected into an HTML page.
 */
export const PORTAL_MIDDLEWARE_MATCHER = [
  '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
];
