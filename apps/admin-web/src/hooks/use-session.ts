'use client';

import { useEffect, useState } from 'react';
import { PLATFORM_ROLE_LABELS } from '@jibli/ui-web';
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
    };

interface MeResponse {
  user_id: string;
  full_name: string | null;
  platform_roles: PlatformRole[];
  restaurant_roles: Record<string, string[]>;
}

interface RefreshResponse {
  access_token: string;
  expires_in_seconds: number;
}

const REFRESH_MARGIN_SECONDS = 60;

export function useAdminSession(): AdminSessionState {
  const [state, setState] = useState<AdminSessionState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

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
        });

        timer = setTimeout(
          () => void load(),
          Math.max(refreshed.expires_in_seconds - REFRESH_MARGIN_SECONDS, 30) * 1000,
        );
      } catch (error) {
        if (cancelled) return;
        setState({
          status: 'unauthenticated',
          ...(error instanceof ApiError ? { reason: error.code } : {}),
        });
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return state;
}
