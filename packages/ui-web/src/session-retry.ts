/**
 * Is this failure a reason to sign somebody out, or a reason to try again?
 *
 * Both portals asked their session endpoint on load and treated every failure
 * the same way: clear the session, render `SignedOut`, redirect to `/login`.
 * That is right for a rejected cookie and wrong for everything else, and
 * "everything else" is most of what actually happens to this deployment.
 *
 * The API runs on a free instance that sleeps after fifteen minutes idle and
 * takes about a minute to wake. The portal proxies `/api` through its own
 * origin and that proxy gives up first, so the first request after a quiet
 * hour comes back as a gateway error with no JSON body — which the client maps
 * to INTERNAL_ERROR, indistinguishable from a rejected session to code that
 * does not look. The operator's own session is perfectly valid. They are sent
 * to the sign-in form anyway, they type a correct password, and *that* request
 * wakes the same sleeping instance and fails the same way. Sign-in is not
 * broken here; it only looks broken, which is worse, because there is nothing
 * to fix in the part everyone is looking at.
 *
 * So: a session is only abandoned when the server actually says the session is
 * no good. A transport failure, a gateway timeout, a 500, a cold start — those
 * are retried, with the delay growing so a genuinely dead API is not hammered.
 */

/**
 * The codes that mean "this session cannot be used", and only those.
 *
 * FORBIDDEN is deliberately absent: it means the account is authenticated and
 * lacks a permission, which signing in again does not change.
 */
const AUTH_FAILURE_CODES = new Set([
  'UNAUTHENTICATED',
  'SESSION_EXPIRED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_SUSPENDED',
  'MFA_REQUIRED',
  'REAUTHENTICATION_REQUIRED',
]);

/**
 * `code` is whatever the client extracted from the error envelope; `status` is
 * the HTTP status. A response with no parseable body arrives as INTERNAL_ERROR
 * with the real status still attached, which is why both are consulted.
 */
export function endsSession(code: string | undefined, status: number | undefined): boolean {
  if (code && AUTH_FAILURE_CODES.has(code)) return true;
  /*
   * 401 with an unrecognised body is still a 401. 403 is not: the request was
   * authenticated and refused.
   */
  return status === 401;
}

/** How long before the next attempt. Roughly 2s, 5s, 12s, 30s, then steady. */
export function retryDelayMs(attempt: number): number {
  const schedule = [2_000, 5_000, 12_000, 30_000];
  return schedule[Math.min(attempt, schedule.length - 1)] ?? 30_000;
}

/**
 * How many times to keep trying before giving up and showing the sign-in form.
 *
 * Four attempts spans about fifty seconds, which covers a cold start with room
 * to spare. Beyond that the API is not slow, it is down, and a page that keeps
 * spinning forever tells the operator less than one that says so.
 */
export const MAX_SESSION_RETRIES = 4;

/**
 * Why a sign-in attempt failed, in the three ways a form has to treat
 * differently.
 *
 * Both portals had one branch for RATE_LIMITED and one for everything else,
 * and "everything else" counted towards a client-side lockout. So a cold API
 * behind a proxy that gives up at thirty seconds locked the operator out of
 * their own sign-in form for typing the right password three times. Nothing
 * had rejected the password — nothing had read it.
 */
export type LoginFailureKind =
  /** The server read the credentials and refused them. Worth slowing down. */
  | 'CREDENTIALS'
  /** The server refused to read them yet. */
  | 'RATE_LIMITED'
  /** Nothing read them: a timeout, a gateway error, an instance waking up. */
  | 'UNREACHABLE';

export function loginFailureKind(
  code: string | undefined,
  status: number | undefined,
): LoginFailureKind {
  if (code === 'RATE_LIMITED') return 'RATE_LIMITED';
  /*
   * No status at all means `fetch` itself failed — DNS, TLS, a dropped
   * connection, the tab going offline. 502/503/504 are the proxy saying the
   * origin did not answer in time, which on a free instance means it was
   * asleep. A 500 is ambiguous, and is grouped here on purpose: an unexpected
   * server error is not evidence that the password was wrong.
   */
  if (status === undefined || status >= 500) return 'UNREACHABLE';
  return 'CREDENTIALS';
}

/** What to tell someone whose sign-in never reached the server. */
export const UNREACHABLE_MESSAGE_AR =
  'تعذّر الوصول إلى الخادم. قد يكون في وضع السكون — انتظر لحظات ثم أعد المحاولة.';

/**
 * After how long a request is slow enough to explain itself.
 *
 * The API sleeps after fifteen minutes idle and takes about a minute to wake.
 * A spinner that says nothing for a minute is read as a broken form, and the
 * next thing that happens is four more attempts against the rate limit.
 */
export const SLOW_REQUEST_HINT_MS = 6_000;

export const SLOW_REQUEST_HINT_AR =
  'الخادم يستيقظ من وضع السكون، قد يستغرق هذا دقيقة في أول محاولة…';
