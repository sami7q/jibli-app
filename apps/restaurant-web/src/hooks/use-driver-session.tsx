'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiRequest } from '@/lib/api';
import { driverApi, type DriverMe } from '@/lib/driver-endpoints';

/**
 * A courier's session.
 *
 * Separate from `use-session` rather than a mode inside it, because the two
 * answer different questions. The restaurant session asks «which restaurants
 * is this account a member of» and fails when the answer is none — which is
 * exactly what a driver is. Threading a second meaning through it would have
 * made every `session.restaurantId` in the portal a maybe.
 *
 * The same refresh cookie carries both. It is HttpOnly and the page never sees
 * it; the access token lives in memory here and is re-derived on every load,
 * which is the arrangement the portals already use (plan §77, §80).
 */

export type DriverSessionState =
  | { status: 'loading' }
  | { status: 'unauthenticated'; reason?: string }
  | {
      status: 'ready';
      accessToken: string;
      me: DriverMe;
      /** Re-read after anything that changes a delivery or availability. */
      refresh: () => void;
    };

interface RefreshResponse {
  access_token: string;
  expires_in_seconds: number;
}

/** Rotate this long before expiry, so no request races the deadline. */
const REFRESH_MARGIN_SECONDS = 60;

export function useDriverSession(): DriverSessionState {
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<DriverMe | null>(null);
  const [failure, setFailure] = useState<{ reason?: string } | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  /*
   * One rotation per tab.
   *
   * `/auth/session/refresh` rotates the refresh token, and presenting a
   * superseded one is treated as replay and revokes every session the user
   * has — so a hook mounted twice would sign the driver out mid-delivery. The
   * guard is the same one the restaurant session carries, for the same reason.
   */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const refreshed = await apiRequest<RefreshResponse>('/api/v1/auth/session/refresh', {
          method: 'POST',
        });

        const profile = await driverApi.me(refreshed.access_token);
        if (cancelled) return;

        setToken(refreshed.access_token);
        setMe(profile);
        setFailure(null);

        const delayMs = Math.max(refreshed.expires_in_seconds - REFRESH_MARGIN_SECONDS, 30) * 1000;
        timer.current = setTimeout(() => void load(), delayMs);
      } catch (error) {
        if (cancelled) return;
        setToken(null);
        setMe(null);
        setFailure(error instanceof ApiError ? { reason: error.code } : {});
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
    // `tick` is deliberate: a delivery transition changes what /driver/me says.
  }, [tick]);

  if (failure) return { status: 'unauthenticated', ...failure };
  if (!token || !me) return { status: 'loading' };
  return { status: 'ready', accessToken: token, me, refresh };
}
