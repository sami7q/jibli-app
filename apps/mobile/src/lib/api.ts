import Constants from 'expo-constants';
import { ERROR_MESSAGES_AR, type ErrorCode, type OrderStatus } from '@jibli/contracts';
import { clearSession, loadSession, updateTokens } from './secure-session';

/**
 * Mobile API client.
 *
 * Handles the two things a mobile client must get right (plan §109, §119):
 *   - a timed-out request is resolved by idempotency key, never by guessing
 *   - an expired access token is refreshed once, transparently, and the
 *     original request is replayed
 */

/**
 * Where requests go.
 *
 * `EXPO_PUBLIC_API_URL` wins when it is set, then the value baked into
 * `app.config.ts`, then localhost as a last resort.
 *
 * The one special case is the browser preview. `expo start --web` runs the app
 * in Chrome, which sends an `Origin` header, and the API's CORS allowlist
 * contains the two portals and not a developer's laptop — so every request
 * from the preview is blocked and every screen renders empty. A phone never
 * hits this: a native client sends no `Origin` at all, which the API's CORS
 * callback explicitly admits.
 *
 * So a development browser, and only a development browser, defaults to the
 * local proxy (`pnpm --filter @jibli/mobile proxy`). Setting
 * EXPO_PUBLIC_API_URL overrides it, and a production web build never takes
 * this branch.
 */
const WEB_DEV_PROXY = 'http://localhost:4010';

/**
 * A browser, checked without importing `react-native`.
 *
 * `Platform.OS === 'web'` would say the same thing, but importing
 * `react-native` here pulls its Flow-typed source into the unit tests, which
 * cannot parse it — and this module holds the single-flight token refresh,
 * which is the last thing that should lose its tests to a convenience import.
 * `document` exists in exactly one of the three environments this runs in.
 */
const isBrowser = typeof document !== 'undefined';
const isDevelopment = typeof __DEV__ !== 'undefined' && __DEV__;

const API_BASE =
  process.env.EXPO_PUBLIC_API_URL ??
  (isBrowser && isDevelopment
    ? WEB_DEV_PROXY
    : ((Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ??
      'http://localhost:4000'));

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
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
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

/** The home screen, as Admin arranged it in «شكل التطبيق». */
export interface Storefront {
  categories: {
    key: string;
    name_ar: string;
    emoji: string | null;
    image_asset_id: string | null;
  }[];
  banners: {
    id: string;
    title_ar: string;
    subtitle_ar: string | null;
    image_asset_id: string | null;
    link_type: 'NONE' | 'CATEGORY' | 'RESTAURANT' | 'URL';
    link_value: string | null;
  }[];
  banner_rotation_seconds: number;
}

/**
 * Where an uploaded image is served from.
 *
 * Built from the id rather than returned per row: the id is what the database
 * stores, and every screen showing a logo, a cover or a category picture needs
 * the same URL from it.
 */
export function assetUrl(assetId: string): string {
  return `${API_BASE}/api/v1/assets/${assetId}`;
}

/** One restaurant, with the whole menu — `GET /restaurants/:id`. */
export interface MenuItem {
  id: string;
  name_ar: string;
  description_ar: string | null;
  price_iqd: number;
  image_asset_id: string | null;
  is_available: boolean;
  is_popular: boolean;
}

export interface MenuCategory {
  id: string;
  name_ar: string;
  description_ar: string | null;
  items: MenuItem[];
}

export interface RestaurantDetail {
  id: string;
  branch_id: string;
  display_name: string;
  description_ar: string | null;
  logo_asset_id: string | null;
  cover_asset_id: string | null;
  cuisine_tags: string[];
  rating: number | null;
  rating_count: number;
  minimum_order_iqd: number;
  delivery_fee_iqd: number;
  address_text: string | null;
  city_name_ar: string;
  is_open: boolean;
  orderable: boolean;
  estimated_preparation_minutes: number;
  categories: MenuCategory[];
}

export interface ModifierGroup {
  id: string;
  name_ar: string;
  min_select: number;
  max_select: number;
  is_required: boolean;
  modifiers: { id: string; name_ar: string; price_iqd: number; is_available: boolean }[];
}

export interface Address {
  id: string;
  label: string | null;
  city_id: string;
  governorate_id: string;
  district_text: string | null;
  street: string | null;
  building: string | null;
  landmark: string | null;
  delivery_notes: string | null;
  is_default: boolean;
}

export interface Quote {
  items_subtotal_iqd: number;
  discount_total_iqd: number;
  delivery_fee_iqd: number;
  platform_service_fee_iqd: number;
  customer_total_iqd: number;
  estimated_preparation_minutes: number;
}

export interface OrderLinePayload {
  menu_item_id: string;
  quantity: number;
  modifier_ids?: string[];
  notes?: string;
}

export interface OrderDetail {
  id: string;
  public_order_number: string;
  status: OrderStatus;
  payment_method: string;
  items_subtotal_iqd: number;
  delivery_fee_iqd: number;
  platform_service_fee_iqd: number;
  discount_total_iqd: number;
  customer_total_iqd: number;
  placed_at: string;
  estimated_preparation_minutes: number;
  customer_notes: string | null;
  restaurant: { name_ar?: string; address_text?: string } | null;
  delivery_address: Record<string, unknown> | null;
  items: {
    id: string;
    name_ar: string;
    unit_price_iqd: number;
    quantity: number;
    line_total_iqd: number;
    notes: string | null;
    modifiers: { name_ar: string; price_iqd: number }[];
  }[];
  timeline: { status: OrderStatus; at: string }[];
  driver: {
    first_name: string;
    phone: string | null;
    photo_asset_id: string | null;
    status: string;
  } | null;
}

/** A favourite, in the same shape as a discovery card. */
export type FavoriteCard = RestaurantCard & { favorited_at: string };

export const api = {
  /**
   * Categories, banners and how fast to rotate them.
   *
   * Unauthenticated on purpose: it is the first request the app makes, before
   * there is a session, and a home screen that needs a sign-in to show a
   * category strip is a home screen nobody reaches.
   */
  storefront: () => apiRequest<Storefront>('/api/v1/storefront', { authenticated: false }),

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

  /** Change the saved name or default area. */
  updateProfile: (payload: { full_name?: string; governorate_id?: string; city_id?: string }) =>
    apiRequest<{ updated: boolean }>('/api/v1/profile', { method: 'PATCH', body: payload }),

  /**
   * Restaurants in a city.
   *
   * Public, and said so explicitly: discovery works signed-out (App Store
   * 5.1.1(ii)), and declaring it saves a keychain read on the request the home
   * screen makes most often.
   */
  restaurants: (cityId: string, search?: string) =>
    apiRequest<RestaurantCard[]>(
      `/api/v1/restaurants?city_id=${cityId}${search ? `&q=${encodeURIComponent(search)}` : ''}`,
      { authenticated: false },
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

  /**
   * One restaurant and its whole menu.
   *
   * Public, like discovery — a guest browsing a menu is the case App Store
   * 5.1.1(ii) is about, and the server has always allowed it.
   */
  restaurant: (restaurantId: string) =>
    apiRequest<RestaurantDetail>(`/api/v1/restaurants/${restaurantId}`, { authenticated: false }),

  /** Options for one dish, fetched when the customer opens it, not up front. */
  itemModifiers: (itemId: string) =>
    apiRequest<ModifierGroup[]>(`/api/v1/catalog/items/${itemId}/modifiers`, {
      authenticated: false,
    }),

  /**
   * The authoritative total.
   *
   * Runs the same pricing path as placement on the server, so what the cart
   * shows and what the customer is charged cannot drift apart (plan §22).
   */
  quote: (payload: {
    restaurant_id: string;
    branch_id: string;
    address_id: string;
    lines: OrderLinePayload[];
  }) => apiRequest<Quote>('/api/v1/checkout/quote', { method: 'POST', body: payload }),

  order: (orderId: string) => apiRequest<OrderDetail>(`/api/v1/orders/${orderId}`),

  cancelOrder: (orderId: string, reason: string) =>
    apiRequest<{ status: string }>(`/api/v1/orders/${orderId}/cancel`, {
      method: 'POST',
      body: { reason },
    }),

  addresses: () => apiRequest<Address[]>('/api/v1/addresses'),

  createAddress: (payload: Record<string, unknown>) =>
    apiRequest<Address>('/api/v1/addresses', { method: 'POST', body: payload }),

  favorites: () => apiRequest<FavoriteCard[]>('/api/v1/favorites'),

  favorite: (restaurantId: string) =>
    apiRequest<{ favorited: boolean }>(`/api/v1/favorites/${restaurantId}`, { method: 'PUT' }),

  unfavorite: (restaurantId: string) =>
    apiRequest<{ favorited: boolean }>(`/api/v1/favorites/${restaurantId}`, { method: 'DELETE' }),

  /**
   * Delete my account — App Store guideline 5.1.1(v).
   *
   * The server anonymises rather than drops: a delivered order is a financial
   * record for the restaurant too. The confirmation screen says so before this
   * is called.
   */
  deleteAccount: () => apiRequest<{ deleted: boolean }>('/api/v1/profile', { method: 'DELETE' }),

  /**
   * Apply to deliver for Jibli.
   *
   * Creates a driver account in `PENDING_ACTIVATION`; an operator activates it.
   * Idempotent — a second call returns the existing application rather than
   * failing, because the second tap is usually someone checking the first.
   */
  applyAsDriver: (payload: { vehicle_type: string; plate_number?: string }) =>
    apiRequest<{
      driver_id: string;
      status: string;
      vehicle_type: string;
      applied_at: string;
      already_applied: boolean;
    }>('/api/v1/driver/apply', { method: 'POST', body: payload }),

  /** My application, or null. Reachable while still pending, unlike `/driver/me`. */
  driverApplication: () =>
    apiRequest<{
      driver_id: string;
      status: string;
      vehicle_type: string;
      plate_number: string | null;
      applied_at: string;
      activated_at: string | null;
      suspended_reason: string | null;
    } | null>('/api/v1/driver/application'),

  /** Whether this order can be rated yet — the 15-minute window (plan §31). */
  reviewEligibility: (orderId: string) =>
    apiRequest<{ can_review: boolean; opens_at: string | null; already_reviewed: boolean }>(
      `/api/v1/orders/${orderId}/review-eligibility`,
    ),

  /** Orders whose rating window is open (plan §31). */
  pendingReviews: () =>
    apiRequest<
      { order_id: string; restaurant_name: string; delivered_at: string; opens_at: string }[]
    >('/api/v1/reviews/pending'),

  submitReview: (orderId: string, rating: number, comment?: string) =>
    apiRequest<{ submitted: boolean }>(`/api/v1/orders/${orderId}/review`, {
      method: 'POST',
      body: { rating, ...(comment ? { comment } : {}) },
    }),
};
