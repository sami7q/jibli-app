import Constants from 'expo-constants';
import { ERROR_MESSAGES_AR, type ErrorCode } from '@jibli/contracts';
import { clearSession, loadSession, updateTokens } from './secure-session';

/**
 * Mobile API client.
 *
 * Handles the two things a mobile client must get right (plan §109, §119):
 *   - a timed-out request is resolved by idempotency key, never by guessing
 *   - an expired access token is refreshed once, transparently, and the
 *     original request is replayed
 */

const API_BASE =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
  process.env.EXPO_PUBLIC_API_URL ??
  'http://localhost:4000';

const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly messageAr: string,
    public readonly details: Record<string, unknown>,
    public readonly status: number,
    public readonly requestId: string,
  ) {
    super(`${code}: ${messageAr}`);
    this.name = 'ApiError';
  }

  /** The app should route the user to the profile flow (plan §11). */
  get needsProfile(): boolean {
    return this.code === 'PROFILE_INCOMPLETE';
  }

  /** The app must force an update before continuing (plan §119). */
  get needsUpdate(): boolean {
    return this.code === 'APP_VERSION_UNSUPPORTED';
  }

  /** The session is gone; sign out rather than retrying. */
  get needsLogin(): boolean {
    return this.code === 'UNAUTHENTICATED' || this.code === 'SESSION_EXPIRED';
  }

  /**
   * The city, restaurant or item changed underneath the user. These are
   * recoverable: refresh the options rather than showing a dead end (plan §112).
   */
  get isRecoverableBusinessError(): boolean {
    return [
      'CITY_NOT_AVAILABLE',
      'GOVERNORATE_NOT_AVAILABLE',
      'ORDERING_NOT_AVAILABLE_IN_CITY',
      'ITEM_UNAVAILABLE',
      'PRICE_CHANGED',
      'RESTAURANT_CLOSED',
      'ADDRESS_OUT_OF_SERVICE',
      'MINIMUM_ORDER_NOT_MET',
    ].includes(this.code);
  }
}

/** Network failure, distinct from an API error the server chose to return. */
export class NetworkError extends Error {
  constructor(public override readonly cause?: unknown) {
    super('تعذّر الاتصال بالخادم');
    this.name = 'NetworkError';
  }
}

interface Envelope<T> {
  data: T;
  meta: Record<string, unknown>;
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  /** Required for money-moving commands (plan §28). */
  readonly idempotencyKey?: string;
  readonly authenticated?: boolean;
  readonly signal?: AbortSignal;
  /** Internal: prevents an infinite refresh loop. */
  readonly _isRetry?: boolean;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Refresh the access token.
 *
 * Deduplicated: several requests failing with 401 at once must trigger exactly
 * one rotation, or the losers would present an already-rotated refresh token
 * and the server would revoke the whole chain as a replay (plan §77).
 */
async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const session = await loadSession();
      if (!session) return false;

      const response = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });

      if (!response.ok) {
        await clearSession();
        return false;
      }

      const envelope = (await response.json()) as Envelope<{
        access_token: string;
        refresh_token: string;
      }>;

      await updateTokens(envelope.data.access_token, envelope.data.refresh_token);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-App-Version': APP_VERSION,
  };

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['X-Idempotency-Key'] = options.idempotencyKey;

  if (options.authenticated !== false) {
    const session = await loadSession();
    if (session) headers.Authorization = `Bearer ${session.accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    // A network failure is NOT a business outcome. For a placed order the
    // caller resolves it by idempotency key rather than assuming failure
    // (plan §109).
    throw new NetworkError(error);
  }

  if (response.status === 401 && !options._isRetry && options.authenticated !== false) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, _isRetry: true });
    }
  }

  if (!response.ok) {
    type ErrorPayload = {
      error?: {
        code: ErrorCode;
        message: string;
        details: Record<string, unknown>;
        request_id: string;
      };
    };

    let payload: ErrorPayload | null = null;
    try {
      payload = (await response.json()) as ErrorPayload;
    } catch {
      /* non-JSON body */
    }

    const code = (payload?.error?.code ?? 'INTERNAL_ERROR') as ErrorCode;
    throw new ApiError(
      code,
      payload?.error?.message ?? ERROR_MESSAGES_AR[code] ?? ERROR_MESSAGES_AR.INTERNAL_ERROR,
      payload?.error?.details ?? {},
      response.status,
      payload?.error?.request_id ?? '',
    );
  }

  if (response.status === 204) return undefined as T;
  const envelope = (await response.json()) as Envelope<T>;
  return envelope.data;
}

/** Stable idempotency key for a command the user may retry (plan §28). */
export function idempotencyKey(scope: string): string {
  const random = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${scope}-${random}`;
}

// ── Endpoints ──────────────────────────────────────────────────────────────

export interface GeographyOption {
  id: string;
  code: string;
  name_ar: string;
}

export interface RestaurantCard {
  id: string;
  branch_id: string;
  display_name: string;
  description_ar: string | null;
  cover_asset_id: string | null;
  cuisine_tags: string[];
  rating: number | null;
  rating_count: number;
  minimum_order_iqd: number;
  delivery_fee_iqd: number;
  estimated_preparation_minutes: number;
  is_open: boolean;
  accepts_orders: boolean;
  city_name_ar: string;
}

export const api = {
  requestOtp: (phone: string) =>
    apiRequest<{ sent: boolean; resend_after_seconds: number; dev_code?: string }>(
      '/api/v1/auth/otp/request',
      { method: 'POST', body: { phone }, authenticated: false },
    ),

  verifyOtp: (phone: string, code: string, deviceId?: string) =>
    apiRequest<{
      access_token: string;
      refresh_token: string;
      user: {
        id: string;
        is_new_user: boolean;
        profile_completed: boolean;
        modes: ('CUSTOMER' | 'DRIVER')[];
        driver_id: string | null;
      };
      next_step: 'HOME' | 'COMPLETE_PROFILE';
    }>('/api/v1/auth/otp/verify', {
      method: 'POST',
      body: { phone, code, deviceId },
      authenticated: false,
    }),

  governorates: (capability: 'customer_signup' | 'ordering' = 'customer_signup') =>
    apiRequest<GeographyOption[]>(`/api/v1/geography/governorates?capability=${capability}`, {
      authenticated: false,
    }),

  cities: (governorateId: string, capability: 'customer_signup' | 'ordering' = 'customer_signup') =>
    apiRequest<GeographyOption[]>(
      `/api/v1/geography/governorates/${governorateId}/cities?capability=${capability}`,
      { authenticated: false },
    ),

  completeProfile: (payload: { full_name: string; governorate_id: string; city_id: string }) =>
    apiRequest<{ profile_completed: boolean; next_step: string }>('/api/v1/profile/complete', {
      method: 'POST',
      body: payload,
    }),

  restaurants: (cityId: string, search?: string) =>
    apiRequest<RestaurantCard[]>(
      `/api/v1/restaurants?city_id=${cityId}${search ? `&q=${encodeURIComponent(search)}` : ''}`,
    ),

  placeOrder: (payload: unknown, key: string) =>
    apiRequest<{
      order_id: string;
      public_order_number: string;
      status: string;
      customer_total_iqd: number;
      delivery_pin: string | null;
    }>('/api/v1/orders', { method: 'POST', body: payload, idempotencyKey: key }),

  myOrders: () =>
    apiRequest<
      { id: string; public_order_number: string; status: string; customer_total_iqd: number; placed_at: string; restaurant_name: string | null }[]
    >('/api/v1/orders'),
};
