import { describe, expect, it } from 'vitest';
import {
  endsSession,
  loginFailureKind,
  MAX_SESSION_RETRIES,
  retryDelayMs,
} from './session-retry.js';

/**
 * These two functions exist to tell one thing apart from another, and the bug
 * they fix was that nothing did. Every case below is a failure that used to be
 * treated as "your session is gone" or "your password is wrong" when it was
 * neither.
 */

describe('endsSession', () => {
  it('ends the session when the server rejects it', () => {
    expect(endsSession('UNAUTHENTICATED', 401)).toBe(true);
    expect(endsSession('SESSION_EXPIRED', 401)).toBe(true);
    expect(endsSession('ACCOUNT_SUSPENDED', 403)).toBe(true);
  });

  it('ends the session on a 401 whose body could not be read', () => {
    // A proxy can answer 401 with HTML. The status is still the server saying
    // this credential is no good.
    expect(endsSession('INTERNAL_ERROR', 401)).toBe(true);
    expect(endsSession(undefined, 401)).toBe(true);
  });

  it('keeps the session through a sleeping API', () => {
    // The shape of the real failure: Vercel's proxy gives up before the free
    // Render instance wakes, so there is no JSON body and the client calls it
    // INTERNAL_ERROR. The cookie in the browser is still perfectly valid.
    expect(endsSession('INTERNAL_ERROR', 504)).toBe(false);
    expect(endsSession('INTERNAL_ERROR', 502)).toBe(false);
    expect(endsSession('INTERNAL_ERROR', 500)).toBe(false);
  });

  it('keeps the session when the request never left the device', () => {
    // `fetch` itself threw: offline, DNS, TLS, a dropped connection.
    expect(endsSession(undefined, undefined)).toBe(false);
  });

  it('keeps the session when a permission is missing', () => {
    // FORBIDDEN means authenticated and not allowed. Signing in again changes
    // nothing, so bouncing to the form is a dead end.
    expect(endsSession('FORBIDDEN', 403)).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('backs off, then holds', () => {
    const delays = Array.from({ length: MAX_SESSION_RETRIES }, (_, i) => retryDelayMs(i));
    expect(delays).toEqual([2_000, 5_000, 12_000, 30_000]);
  });

  it('spans a cold start before giving up', () => {
    const total = Array.from({ length: MAX_SESSION_RETRIES }, (_, i) => retryDelayMs(i)).reduce(
      (sum, value) => sum + value,
      0,
    );
    // A free instance takes about a minute to wake; the window has to cover it.
    expect(total).toBeGreaterThanOrEqual(45_000);
  });

  it('never returns undefined past the end of the schedule', () => {
    expect(retryDelayMs(99)).toBe(30_000);
  });
});

describe('loginFailureKind', () => {
  it('counts a rejected password', () => {
    expect(loginFailureKind('INVALID_CREDENTIALS', 401)).toBe('CREDENTIALS');
  });

  it('does not count an attempt the server never read', () => {
    // This is what locked operators out of their own sign-in form: three
    // correct passwords against a waking API, each counted as a failure.
    expect(loginFailureKind('INTERNAL_ERROR', 504)).toBe('UNREACHABLE');
    expect(loginFailureKind(undefined, undefined)).toBe('UNREACHABLE');
    expect(loginFailureKind('INTERNAL_ERROR', 500)).toBe('UNREACHABLE');
  });

  it('separates the server refusing to read from the password being wrong', () => {
    expect(loginFailureKind('RATE_LIMITED', 429)).toBe('RATE_LIMITED');
  });
});
