'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  endsSession,
  MAX_SESSION_RETRIES,
  PLATFORM_ROLE_LABELS,
  retryDelayMs,
} from '@jibli/ui-web';
import { adminPermissionsFor, type AdminPermission, type PlatformRole } from '@jibli/contracts';
import { apiRequest, ApiError } from '@/lib/api';

/**
 * Admin session.
 *
 * Same in-memory access token and HttpOnly refresh cookie as the restaurant
 * portal (plan §77). Admin additionally tracks MFA freshness, because sensitive
 * finance and role actions demand a recent challenge (plan §88).
 */

export type AdminSessionState =
  | { status: 'loading' }
  | { status: 'unauthenticated'; reason?: string }
  | {
      status: 'authenticated';
      accessToken: string;
      userId: string;
      userName: string;
      roles: PlatformRole[];
      /** Resolved from roles. The server enforces each one independently —
       *  this only decides what the UI offers (plan §85). */
      permissions: AdminPermission[];
      can: (permission: AdminPermission) => boolean;
      roleAr: string;
      /**
       * The account signed in with a password someone else issued and has not
       * replaced it yet (ADMIN-10). The server refuses every route but the
       * password change itself, so the shell sends the operator there rather
       * than letting each page render a PASSWORD_CHANGE_REQUIRED error box.
       */
      mustChangePassword: boolean;
    };

interface MeResponse {
  user_id: string;
  full_name: string | null;
  platform_roles: PlatformRole[];
  restaurant_roles: Record<string, string[]>;
  must_change_password?: boolean;
}

interface RefreshResponse {
  access_token: string;
  expires_in_seconds: number;
}

const REFRESH_MARGIN_SECONDS = 60;

/**
 * One session per tab, not one per page.
 *
 * This used to be a plain hook, and all eighteen authenticated pages called it.
 * Every page mount therefore ran its own `POST /auth/session/refresh`, and that
 * endpoint *rotates* the refresh token: the old one is marked superseded, and
 * presenting a superseded token is treated as replay and revokes every session
 * the user has. Legitimate navigation looked exactly like an attack, so moving
 * between pages signed people out.
 *
 * The provider owns the single refresh loop. The hook below reads it, and asks
 * the provider to start on first use — which is what keeps the sign-in page
 * from requesting a session it does not have yet, over a link to a free-tier
 * API that may take a minute to wake.
 *
 * A second browser tab still holds a second owner. That is inherent to rotating
 * refresh tokens and needs a cross-tab lock to solve; it is rare, where a
 * navigation was constant.
 */
interface AdminSessionContextValue {
  readonly state: AdminSessionState;
  readonly start: () => void;
  /**
   * Swap the in-memory access token for a fresher one (ADMIN-1).
   *
   * A step-up challenge (`/auth/mfa/verify`) mints a new token carrying the
   * `mfaAt` claim. The retried sensitive action has to present *that* token,
   * not the one the provider is holding — which has no step-up stamp and would
   * 401 again. The refresh loop is left running: the server now carries the
   * step-up forward across rotation, so the next refresh keeps it too.
   */
  readonly applyAccessToken: (token: string) => void;
}

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

export function AdminSessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AdminSessionState>({ status: 'loading' });
  const [active, setActive] = useState(false);
  const started = useRef(false);

  const start = (): void => {
    if (started.current) return;
    started.current = true;
    setActive(true);
  };

  const applyAccessToken = (token: string): void => {
    setState((prev) => (prev.status === 'authenticated' ? { ...prev, accessToken: token } : prev));
  };

  useEffect(() => {
    if (!active) return undefined;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    /*
     * Consecutive transport failures, reset by any success. Not state: it is
     * read and written inside one async loop and nothing renders from it, so
     * putting it in state would only schedule renders nobody sees.
     */
    let failures = 0;

    const load = async (): Promise<void> => {
      try {
        /*
         * The web refresh endpoint reads the HttpOnly cookie. `/auth/refresh`
         * takes the token in the body and is the mobile client's path — calling
         * it from here would mean the page had to hold a refresh token, which
         * is exactly what the cookie exists to prevent (plan §80).
         */
        const refreshed = await apiRequest<RefreshResponse>('/api/v1/auth/session/refresh', {
          method: 'POST',
        });

        const me = await apiRequest<MeResponse>('/api/v1/auth/me', {
          accessToken: refreshed.access_token,
        });

        if (cancelled) return;

        failures = 0;

        if (me.platform_roles.length === 0) {
          // A valid customer session is not an admin session. Saying so beats
          // rendering an empty portal the user has no rights in.
          setState({ status: 'unauthenticated', reason: 'NOT_PLATFORM_STAFF' });
          return;
        }

        const primaryRole = me.platform_roles[0] as PlatformRole;
        const granted = adminPermissionsFor(me.platform_roles);

        setState({
          status: 'authenticated',
          accessToken: refreshed.access_token,
          userId: me.user_id,
          userName: me.full_name ?? 'مستخدم',
          roles: me.platform_roles,
          permissions: [...granted],
          can: (permission) => granted.has(permission),
          roleAr: PLATFORM_ROLE_LABELS[primaryRole] ?? '',
          mustChangePassword: me.must_change_password ?? false,
        });

        timer = setTimeout(
          () => void load(),
          Math.max(refreshed.expires_in_seconds - REFRESH_MARGIN_SECONDS, 30) * 1000,
        );
      } catch (error) {
        if (cancelled) return;

        const code = error instanceof ApiError ? error.code : undefined;
        const status = error instanceof ApiError ? error.status : undefined;

        /*
         * Only a server that rejected the session ends it. Everything else —
         * a sleeping API, a gateway timeout, a dropped connection — is retried
         * while the page keeps showing its loading state, because the session
         * in the cookie is still perfectly good and sending the operator to
         * the sign-in form would be a lie about what went wrong.
         */
        if (!endsSession(code, status) && failures < MAX_SESSION_RETRIES) {
          const delay = retryDelayMs(failures);
          failures += 1;
          timer = setTimeout(() => void load(), delay);
          // Stay in `loading`: the session is unknown, not absent.
          setState({ status: 'loading' });
          return;
        }

        setState({
          status: 'unauthenticated',
          ...(code ? { reason: code } : {}),
        });
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [active]);

  return (
    <AdminSessionContext.Provider value={{ state, start, applyAccessToken }}>
      {children}
    </AdminSessionContext.Provider>
  );
}

export function useAdminSession(): AdminSessionState {
  const context = useContext(AdminSessionContext);

  useEffect(() => {
    context?.start();
    // The provider guards re-entry, so this is safe to call on every mount.
  }, [context]);

  if (!context) {
    throw new Error('useAdminSession must be used inside <AdminSessionProvider>');
  }
  return context.state;
}

/**
 * The token-swap callback, for the step-up dialog (ADMIN-1).
 *
 * Separate from `useAdminSession` so the common read path does not also force
 * the `start()` effect that hook runs; this one is only used by a component
 * that already sits inside an authenticated page.
 */
export function useApplyAccessToken(): (token: string) => void {
  const context = useContext(AdminSessionContext);
  if (!context) {
    throw new Error('useApplyAccessToken must be used inside <AdminSessionProvider>');
  }
  return context.applyAccessToken;
}
