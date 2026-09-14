'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { RestaurantPermission, RestaurantRole } from '@jibli/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest, ApiError } from '@/lib/api';

/**
 * Portal session.
 *
 * The access token lives in memory only. Persisting it in localStorage would
 * expose it to any injected script; the refresh token travels in an HttpOnly
 * cookie the page cannot read, which is what makes a silent refresh safe
 * (plan §77, §80).
 */

export interface PortalRestaurant {
  readonly id: string;
  readonly display_name: string;
  readonly partner_code: string;
  readonly operational_status: string;
  readonly roles: RestaurantRole[];
  readonly permissions: RestaurantPermission[];
}

export type SessionState =
  | { status: 'loading' }
  | {
      status: 'unauthenticated';
      reason?: string;
      /**
       * Who is signed in, when somebody is.
       *
       * Only ever set for NO_RESTAURANT_MEMBERSHIP, which is the one failure
       * where the session is perfectly valid — so the screen can name the
       * account instead of leaving the reader to guess which of their logins
       * this is.
       */
      account?: string;
    }
  | {
      status: 'authenticated';
      accessToken: string;
      userId: string;
      userName: string;
      restaurantId: string;
      restaurantName: string;
      partnerCode: string;
      roles: RestaurantRole[];
      permissions: RestaurantPermission[];
      /** Every restaurant this session may switch to. Usually one. */
      restaurants: PortalRestaurant[];
      /** Server-enforced too — this only decides what the UI offers. */
      can: (permission: RestaurantPermission) => boolean;
      switchRestaurant: (restaurantId: string) => void;
    };

interface MeResponse {
  user: { id: string; full_name: string | null };
  restaurants: PortalRestaurant[];
}

interface RefreshResponse {
  access_token: string;
  expires_in_seconds: number;
}

/** Refresh this long before expiry so a request never races the deadline. */
const REFRESH_MARGIN_SECONDS = 60;

/**
 * Which restaurant the user last worked in.
 *
 * Only an identifier the server already checks membership against, so storing
 * it is harmless — unlike a token. It survives a reload so a two-branch owner
 * does not re-pick on every visit.
 */
const SELECTED_KEY = 'jibli.portal.restaurant';

function readSelected(): string | null {
  try {
    return window.localStorage.getItem(SELECTED_KEY);
  } catch {
    // Private mode or blocked site data — fall back to the first membership.
    return null;
  }
}

function writeSelected(restaurantId: string): void {
  try {
    window.localStorage.setItem(SELECTED_KEY, restaurantId);
  } catch {
    // Losing the preference is not worth failing the page over.
  }
}

interface LoadedSession {
  accessToken: string;
  userId: string;
  userName: string;
  restaurants: PortalRestaurant[];
}

/**
 * One session per tab, not one per page — see the admin portal's provider for
 * the full account. In short: `/auth/session/refresh` rotates the refresh
 * token, presenting a superseded one is treated as replay and revokes every
 * session the user has, and a hook called from several components ran one
 * refresh per mount. Navigating signed people out.
 */
function useSessionState(active: boolean): SessionState {
  const [loaded, setLoaded] = useState<LoadedSession | null>(null);
  const [failure, setFailure] = useState<{ reason?: string; account?: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

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

        const me = await apiRequest<MeResponse>('/api/v1/restaurant-portal/me', {
          accessToken: refreshed.access_token,
        });

        if (cancelled) return;

        if (me.restaurants.length === 0) {
          // Authenticated, but not a member of any restaurant — the portal has
          // nothing to show, and saying so beats an empty dashboard.
          setFailure({
            reason: 'NO_RESTAURANT_MEMBERSHIP',
            account: me.user.full_name ?? undefined,
          });
          setLoaded(null);
          return;
        }

        setFailure(null);
        setLoaded({
          accessToken: refreshed.access_token,
          userId: me.user.id,
          userName: me.user.full_name ?? 'مستخدم',
          restaurants: me.restaurants,
        });

        // Schedule the next rotation before this token expires.
        const delayMs =
          Math.max(refreshed.expires_in_seconds - REFRESH_MARGIN_SECONDS, 30) * 1000;
        refreshTimer = setTimeout(() => void load(), delayMs);
      } catch (error) {
        if (cancelled) return;
        setLoaded(null);
        setFailure(error instanceof ApiError ? { reason: error.code } : {});
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [active]);

  const switchRestaurant = useCallback(
    (restaurantId: string) => {
      writeSelected(restaurantId);
      setSelectedId(restaurantId);

      /*
       * Drop everything fetched for the previous restaurant.
       *
       * Every query key already carries the restaurant id, so the wrong branch
       * is never *displayed* — but its rows stay in the cache, and switching
       * back paints them instantly from a snapshot that may be hours old
       * before the refetch lands. On a screen about live orders and money, a
       * stale first paint is the kind of thing somebody acts on.
       */
      queryClient.clear();
    },
    [queryClient],
  );

  return useMemo<SessionState>(() => {
    if (failure) return { status: 'unauthenticated', ...failure };
    if (!loaded) return { status: 'loading' };

    // A remembered selection is honoured only while it is still a membership —
    // a revoked role must not keep steering the portal at that restaurant.
    const remembered = selectedId ?? (typeof window === 'undefined' ? null : readSelected());
    const active =
      loaded.restaurants.find((entry) => entry.id === remembered) ?? loaded.restaurants[0];

    if (!active) return { status: 'unauthenticated', reason: 'NO_RESTAURANT_MEMBERSHIP' };

    const granted = new Set(active.permissions);

    return {
      status: 'authenticated',
      accessToken: loaded.accessToken,
      userId: loaded.userId,
      userName: loaded.userName,
      restaurantId: active.id,
      restaurantName: active.display_name,
      partnerCode: active.partner_code,
      roles: active.roles,
      permissions: active.permissions,
      restaurants: loaded.restaurants,
      can: (permission) => granted.has(permission),
      switchRestaurant,
    };
  }, [failure, loaded, selectedId, switchRestaurant]);
}

interface SessionContextValue {
  readonly state: SessionState;
  readonly start: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const started = useRef(false);
  const state = useSessionState(active);

  /*
   * Started on first use rather than on mount: the sign-in page sits inside
   * this provider too, and asking for a session it does not have yet costs a
   * round trip to an API that may be asleep.
   */
  const start = (): void => {
    if (started.current) return;
    started.current = true;
    setActive(true);
  };

  return <SessionContext.Provider value={{ state, start }}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const context = useContext(SessionContext);

  useEffect(() => {
    context?.start();
  }, [context]);

  if (!context) throw new Error('useSession must be used inside <SessionProvider>');
  return context.state;
}
