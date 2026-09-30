import Constants from 'expo-constants';
import { configString } from './app-config';
import {
  ERROR_MESSAGES_AR,
  type ErrorCode,
  type MerchantType,
  type OrderStatus,
} from '@jibli/contracts';
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
    : (configString('apiUrl') ?? 'http://localhost:4000'));

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
  /**
   * Which shop a portal request is about.
   *
   * A *selector*, never a grant: `resolveRestaurantScope` on the server throws
   * TENANT_MISMATCH unless the session already proves membership of it. It is
   * needed because an owner may hold two shops, and the server refuses to guess
   * which one a write is for.
   */
  readonly restaurantId?: string;
  /**
   * A caller's own abort signal — a screen cancelling on unmount, say.
   *
   * Composed with the default timeout below rather than replacing it: passing
   * one should not silently opt a request out of ever giving up.
   */
  readonly signal?: AbortSignal;
  /**
   * Override the default timeout for this request, in milliseconds.
   *
   * `0` disables it, which nothing should need — it exists so that a future
   * long-running upload has a way to say so explicitly rather than by
   * forgetting.
   */
  readonly timeoutMs?: number;
  /** Internal: prevents an infinite refresh loop. */
  readonly _isRetry?: boolean;
  /** Internal: how many cold-start retries this request has already spent. */
  readonly _coldStartAttempt?: number;
}

/**
 * How long a request may hang before the app stops waiting for it.
 *
 * `fetch` has no default timeout — not in React Native, not anywhere. A TCP
 * connection that opens and is never answered, which is an ordinary event on
 * Iraqi mobile data and the normal one on a train or in a lift, left the app
 * on a spinner *forever*: no error, no retry, no way out but force-quitting.
 * Every screen in the app had this, because every screen goes through here.
 *
 * Two numbers, because the two cases are not the same risk. A read that gives
 * up early can simply be retried, and fifteen seconds is already far past the
 * point a customer decides the app is broken. A write is given twice that: it
 * may have reached the server and be committing, and aborting the *client*
 * does not abort that — so the longer wait buys the answer rather than an
 * uncertainty the customer has to resolve by guessing.
 *
 * The cold-start path already handles the other shape of slowness — a gateway
 * that answers quickly to say the server is still waking — so this is only
 * about silence.
 */
const READ_TIMEOUT_MS = 15_000;
const WRITE_TIMEOUT_MS = 30_000;

/**
 * One signal that fires when either the caller's or the timeout's does.
 *
 * `AbortSignal.any` is the obvious way to write this and is not on Hermes, so
 * this is the same thing with a listener. The timer is cleared by the caller
 * once the request settles, or a request that finishes in 200 ms still holds a
 * 15-second timer and, on a busy list screen, a few hundred of them.
 */
function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal | undefined; done: () => void; timedOut: () => boolean } {
  if (timeoutMs <= 0) return { signal, done: () => {}, timedOut: () => false };

  const controller = new AbortController();
  let expired = false;

  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, timeoutMs);

  const forward = () => controller.abort();
  if (signal) {
    if (signal.aborted) forward();
    else signal.addEventListener('abort', forward);
  }

  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forward);
    },
    timedOut: () => expired,
  };
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

      /*
       * Its own timeout, because this one does not go through `apiRequest`.
       *
       * It cannot: `apiRequest` is what calls *this* on a 401, and routing the
       * refresh back through it would recurse. So the guarantee has to be
       * repeated here — and it matters more here than anywhere, since every
       * request waiting on a 401 is waiting on this single promise. A refresh
       * that hangs hangs the whole app, not one screen.
       */
      const refresh = withTimeout(undefined, WRITE_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: session.refreshToken }),
          ...(refresh.signal ? { signal: refresh.signal } : {}),
        });
      } finally {
        refresh.done();
      }

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

/**
 * A gateway saying the server is not there — as opposed to the server saying no.
 *
 * The API is on a plan that spins the service down when it is idle and takes
 * about a minute to wake it. During that minute the edge answers 502 or 503
 * with an HTML page the app cannot parse, which used to surface as «حدث خطأ
 * غير متوقع» — the one message that tells a customer nothing. The browser
 * preview sits behind a proxy that waits the cold start out; a phone talks to
 * the API directly and has nobody to do that for it.
 */
const COLD_START_STATUSES = new Set([502, 503, 504]);
const COLD_START_RETRIES = 2;
const COLD_START_BACKOFF_MS = 4000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Where the realtime socket lives: the API's own origin over `ws(s)://`.
 *
 * Not through the development web proxy — it forwards HTTP only — so a browser
 * preview without `EXPO_PUBLIC_API_URL` simply falls back to polling, which is
 * what every live screen does anyway when the socket is down.
 */
export function realtimeUrl(): string {
  return `${API_BASE.replace(/^http/, 'ws')}/api/v1/realtime`;
}

/** Seconds of life a token must have left to be worth handing to a socket. */
const SOCKET_TOKEN_MARGIN_S = 60;

/** The `exp` claim of a JWT, or null when it cannot be read. */
function tokenExpiry(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const claims = JSON.parse(globalThis.atob(padded)) as { exp?: unknown };
    return typeof claims.exp === 'number' ? claims.exp : null;
  } catch {
    return null;
  }
}

/**
 * An access token a WebSocket can open with.
 *
 * A socket is authenticated once, at the handshake, and `apiRequest`'s
 * refresh-on-401 never sees it — so a token with seconds left would open a
 * socket that the next reconnect cannot reopen. Refreshed here first when it
 * is close to expiring, through the same single-flight refresh every request
 * shares, so a socket and a burst of requests cannot race two refreshes.
 */
export async function accessTokenForSocket(): Promise<string | null> {
  const session = await loadSession();
  if (!session) return null;

  const expiry = tokenExpiry(session.accessToken);
  if (expiry !== null && expiry * 1000 - Date.now() > SOCKET_TOKEN_MARGIN_S * 1000) {
    return session.accessToken;
  }

  const refreshed = await refreshAccessToken();
  if (!refreshed) return null;
  return (await loadSession())?.accessToken ?? null;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-App-Version': APP_VERSION,
  };

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey) headers['X-Idempotency-Key'] = options.idempotencyKey;
  if (options.restaurantId) headers['X-Restaurant-Id'] = options.restaurantId;

  if (options.authenticated !== false) {
    const session = await loadSession();
    if (session) headers.Authorization = `Bearer ${session.accessToken}`;
  }

  const httpMethod = options.method ?? 'GET';
  const timeout = withTimeout(
    options.signal,
    options.timeoutMs ?? (httpMethod === 'GET' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS),
  );

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: httpMethod,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      ...(timeout.signal ? { signal: timeout.signal } : {}),
    });
  } catch (error) {
    // A network failure is NOT a business outcome. For a placed order the
    // caller resolves it by idempotency key rather than assuming failure
    // (plan §109).
    //
    // A timeout arrives here as an AbortError and is the same thing as far as
    // the caller is concerned — the request has no answer — so it is reported
    // as one rather than as a fourth error class every screen would have to
    // learn. `timedOut()` distinguishes it from a caller who cancelled on
    // purpose, which must stay an abort and not become a red banner.
    if (options.signal?.aborted && !timeout.timedOut()) throw error;
    throw new NetworkError(error);
  } finally {
    timeout.done();
  }

  if (response.status === 401 && !options._isRetry && options.authenticated !== false) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      return apiRequest<T>(path, { ...options, _isRetry: true });
    }
  }

  /*
   * Wait out a cold start, on reads only.
   *
   * A GET may be repeated freely — that is what makes it a GET. A write is not
   * retried here even though the status says the request never arrived,
   * because "never arrived" is what the gateway believes and not what the
   * server knows; a duplicated order is a worse outcome than a retry the
   * customer performs themselves (plan §109).
   */
  if (
    COLD_START_STATUSES.has(response.status) &&
    httpMethod === 'GET' &&
    (options._coldStartAttempt ?? 0) < COLD_START_RETRIES
  ) {
    const attempt = (options._coldStartAttempt ?? 0) + 1;
    await sleep(COLD_START_BACKOFF_MS * attempt);
    return apiRequest<T>(path, { ...options, _coldStartAttempt: attempt });
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

    /*
     * An unparseable 5xx is the infrastructure answering, not the API. Saying
     * «الخدمة غير متاحة حالياً، الرجاء المحاولة بعد قليل» is both true and
     * actionable; «حدث خطأ غير متوقع» is neither.
     */
    const fallback: ErrorCode = response.status >= 500 ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR';
    const code = (payload?.error?.code ?? fallback) as ErrorCode;
    const messageAr =
      payload?.error?.message ?? ERROR_MESSAGES_AR[code] ?? ERROR_MESSAGES_AR.INTERNAL_ERROR;

    /*
     * Announced before it is thrown, because the throw is caught by whichever
     * caller happened to be asking and would otherwise be shown as that
     * screen's local failure.
     */
    if (code === 'APP_VERSION_UNSUPPORTED') announceVersionUnsupported(messageAr);

    throw new ApiError(
      code,
      messageAr,
      payload?.error?.details ?? {},
      response.status,
      payload?.error?.request_id ?? '',
    );
  }

  if (response.status === 204) return undefined as T;
  const envelope = (await response.json()) as Envelope<T>;
  return envelope.data;
}

// ── "This version can no longer be used" ───────────────────────────────────

/**
 * The server's answer that the app itself is the problem (plan §119).
 *
 * `ApiError.needsUpdate` has existed since this file was written and nothing
 * ever read it, so the one error the customer *can* act on — «حدّث التطبيق» —
 * arrived as the generic «تعذّر الاتصال» on whichever screen happened to ask.
 * The version is sent on every request as `X-App-Version`, so the server can
 * raise this at any moment, from any call.
 *
 * That is exactly why it is a broadcast rather than a return value: no single
 * screen owns it. It is a fact about the binary, so it is published once here
 * and `UpdateGate` draws over everything when it hears it.
 *
 * One-way on purpose. A version does not become supported again while the app
 * is running, and a gate that could be dismissed would be a gate the customer
 * taps past on the way to a checkout the server is going to refuse anyway.
 */
type VersionListener = (messageAr: string) => void;

const versionListeners = new Set<VersionListener>();
let versionUnsupportedMessage: string | null = null;

export function onVersionUnsupported(listener: VersionListener): () => void {
  versionListeners.add(listener);
  // A listener mounting after the fact still needs to know.
  if (versionUnsupportedMessage) listener(versionUnsupportedMessage);
  return () => versionListeners.delete(listener);
}

function announceVersionUnsupported(messageAr: string): void {
  if (versionUnsupportedMessage) return;
  versionUnsupportedMessage = messageAr;
  for (const listener of versionListeners) listener(messageAr);
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

/**
 * A governorate with its selectable cities, from `GET /geography/tree`.
 *
 * One round trip rather than two, which matters here for a reason the picker
 * does not have: matching a pin to a city has to look at every city at once,
 * and drilling per governorate to do it would be nineteen requests to answer
 * one question.
 */
export interface GeographyBranch {
  id: string;
  code: string;
  name_ar: string;
  cities: GeographyOption[];
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
  /**
   * What the customer pays Jibli per order — «رسوم الخدمة».
   *
   * Carried on the storefront so the cart can show the real total before an
   * address exists. The quote is still authoritative; this is the same
   * setting, read early.
   */
  service_fee_iqd: number;
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
  has_options: boolean;
  /**
   * A required choice — a size, a bread — so the sheet must be opened.
   *
   * Adding such an item straight to the cart produces a line the kitchen
   * cannot fill, and the server refuses it at the quote with
   * MODIFIER_SELECTION_INVALID.
   */
  requires_choice: boolean;
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

/**
 * A saved delivery address, as `GET /addresses` actually returns it.
 *
 * This type used to describe something else: flat `city_id` and
 * `governorate_id` that the endpoint has never sent, no `floor`, no
 * `orderable`, and no coordinates. Nothing broke only because nothing read
 * them — the address list showed the free-text lines and stopped there. Now
 * that the address screen shows the city and the pin, the shape has to be the
 * real one.
 */
export interface Address {
  id: string;
  label: string | null;
  /** Nested, with the Arabic name — the endpoint joins both tables for this. */
  governorate: { id: string; name_ar: string };
  city: { id: string; name_ar: string };
  district_text: string | null;
  street: string | null;
  building: string | null;
  floor: string | null;
  landmark: string | null;
  delivery_notes: string | null;
  is_default: boolean;
  /**
   * The point a courier is routed to, when the customer put one down.
   *
   * `null` is not a defect: in a city addressed by landmarks the driver's link
   * falls back to searching the text, and that fallback is why a wrong point
   * is worse than none.
   */
  latitude: number | null;
  longitude: number | null;
  /**
   * Whether this address is in a city currently taking orders.
   *
   * An address in a closed city stays saved — the customer may be waiting for
   * a launch — and is judged at checkout rather than deleted.
   */
  orderable: boolean;
}

/** A row of `GET /driver/deliveries`. */
export interface DriverDeliverySummary {
  assignment_id: string;
  order_id: string;
  public_order_number: string;
  status: string;
  order_status: string;
  restaurant_name: string;
  payment_method: string;
  cash_to_collect_iqd: number;
  assigned_at: string;
  customer: { name: string; phone: string | null };
  delivery_address: Record<string, unknown>;
  restaurant_location: Record<string, unknown> | null;
}

/** Links that carry coordinates and nothing else — never a token or the PIN. */
export interface DriverNavigationLinks {
  googleMaps: string | null;
  waze: string | null;
  copyableAddress: string | null;
  hasCoordinates: boolean;
}

/** `GET /driver/deliveries/:assignmentId` — one task, in full. */
export interface DriverDeliveryTask {
  assignment_id: string;
  order_id: string;
  public_order_number: string;
  status: string;
  /**
   * The order's own stage. A courier may collect only a READY order; absent on
   * an API deployed before pickup was gated on it.
   */
  order_status?: OrderStatus;
  payment_method?: string;
  cash_to_collect_iqd: number;
  customer: { name: string; phone: string };
  customer_notes: string | null;
  delivery_address: Record<string, unknown>;
  navigation: DriverNavigationLinks;
  restaurant_navigation: DriverNavigationLinks;
  /** Where to collect it. Absent on an older API. */
  restaurant?: {
    name: string;
    branch_name: string | null;
    phone: string | null;
    address_text: string | null;
    city_name_ar: string | null;
  };
  /** What is in the bag, to check at the counter. */
  items?: { name_ar: string; quantity: number; notes: string | null }[];
  /** The shop's promised ready time (accepted at + its estimate). */
  ready_by?: string | null;
  ready_at?: string | null;
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

/** One dish from `GET /menu/search`, carrying the restaurant that sells it. */
export interface DishResult {
  id: string;
  name_ar: string;
  description_ar: string | null;
  price_iqd: number;
  image_asset_id: string | null;
  is_available: boolean;
  is_popular: boolean;
  /**
   * The dish carries a required choice — a size, a bread.
   *
   * One-tap add produces a line the kitchen cannot fill and the quote refuses
   * the whole order, so the row opens the item instead of adding it.
   */
  requires_choice: boolean;
  restaurant: {
    id: string;
    branch_id: string;
    display_name: string;
    cover_asset_id: string | null;
    rating: number | null;
    delivery_fee_iqd: number;
    minimum_order_iqd: number;
    estimated_preparation_minutes: number;
    is_open: boolean;
    accepts_orders: boolean;
  };
}

/** One entry in the notification centre. */
/**
 * One shop this account belongs to — `GET /restaurant-portal/me`.
 *
 * `merchant_type` is the whole of how Owner Mode decides what to show. The
 * endpoint has carried it since before there was a phone client, with a comment
 * saying it exists "so the portal can say «المنتجات» to a grocer and «القائمة»
 * to a cook."
 */
export interface OwnerShop {
  readonly id: string;
  readonly display_name: string;
  readonly partner_code: string;
  readonly merchant_type: MerchantType;
  readonly operational_status: string;
  readonly roles: string[];
  readonly permissions: string[];
}

/** One product. A market's product is a menu item; there is no second table. */
export interface OwnerProduct {
  readonly id: string;
  readonly name_ar: string;
  readonly description_ar: string | null;
  readonly base_price_iqd: number;
  readonly image_asset_id: string | null;
  readonly is_active: boolean;
  readonly is_available: boolean;
  readonly sort_order: number;
}

export interface OwnerCategory {
  readonly id: string;
  readonly name_ar: string;
  readonly sort_order: number;
  readonly is_active: boolean;
  readonly items: OwnerProduct[];
}

export interface OwnerCatalog {
  readonly menu_version: number;
  readonly categories: OwnerCategory[];
}

/** What the server accepts when creating a product. */
export interface OwnerProductInput {
  readonly category_id: string;
  readonly name_ar: string;
  readonly base_price_iqd: number;
  readonly description_ar?: string;
  readonly image_asset_id?: string | null;
  readonly sort_order?: number;
}

export interface OrderNotification {
  id: string;
  order_id: string;
  public_order_number: string;
  status: OrderStatus;
  restaurant_name: string | null;
  at: string;
}

/** A favourite, in the same shape as a discovery card. */
export type FavoriteCard = RestaurantCard & { favorited_at: string };

/**
 * What every way into the app returns.
 *
 * One-time code, registration, password, password reset — four doors, one
 * answer, because what the app does next depends on the account rather than on
 * how the customer proved they own it. `next_step` is that decision, made
 * server-side: a name is not a complete profile, so a customer who has just
 * registered still needs a governorate and a city before they can order.
 */
export interface AuthSessionResponse {
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
}

/** Where a courier stands right now — `GET /driver/me`. */
export interface DriverMe {
  driver_id: string;
  status: string;
  /** OFFLINE, AVAILABLE, BUSY, ON_DELIVERY or BREAK. */
  availability: string;
  vehicle_type: string;
  active_assignment_id: string | null;
  active_assignment_status: string | null;
}

/** Restaurant cash a courier is holding — never a Jibli balance. */
export interface DriverCash {
  collected_iqd: number;
  handed_over_iqd: number;
  adjustments_iqd: number;
  current_custody_iqd: number;
}

/** One order on a shop's live board — `GET /restaurant-portal/orders/live`. */
export interface OwnerLiveOrder {
  id: string;
  public_order_number: string;
  status: OrderStatus;
  age_minutes: number;
  placed_at: string;
  customer_name: string;
  customer_phone: string;
  customer_notes: string | null;
  payment_method: string;
  items_subtotal_iqd: number;
  delivery_fee_iqd: number;
  customer_total_iqd: number;
  /** Optimistic-concurrency token: every command sends back the one it saw. */
  version: number;
  delivery_address: Record<string, unknown>;
  /** Minutes the shop said it needs, set on acceptance. */
  estimated_preparation_minutes?: number;
  accepted_at?: string | null;
  driver: { name: string; phone?: string | null; assignment_status: string } | null;
  items: {
    id: string;
    name_ar: string;
    quantity: number;
    line_total_iqd: number;
    notes: string | null;
    modifiers: { name_ar: string; price_iqd: number }[];
  }[];
}

/** A courier the shop could hand an order to. */
export interface OwnerEligibleDriver {
  id: string;
  name: string;
  phone: string;
  availability: string;
  active_assignments: number;
  assignable: boolean;
}

export type OwnerRejectReason =
  'ITEM_UNAVAILABLE' | 'TOO_BUSY' | 'CLOSING' | 'ADDRESS_ISSUE' | 'CUSTOMER_UNREACHABLE' | 'OTHER';

export const api = {
  /**
   * Categories, banners and how fast to rotate them.
   *
   * Unauthenticated on purpose: it is the first request the app makes, before
   * there is a session, and a home screen that needs a sign-in to show a
   * category strip is a home screen nobody reaches.
   */
  /**
   * The front page of one half of the app.
   *
   * The banners and the category strip belong to a section rather than to the
   * app, so this always names one. Omitting it on the server means the food
   * half, which is what callers written before markets existed meant.
   */
  storefront: (merchantType: MerchantType = 'RESTAURANT') =>
    apiRequest<Storefront>(`/api/v1/storefront?merchant_type=${merchantType}`, {
      authenticated: false,
    }),

  requestOtp: (phone: string) =>
    apiRequest<{ sent: boolean; resend_after_seconds: number; dev_code?: string }>(
      '/api/v1/auth/otp/request',
      { method: 'POST', body: { phone }, authenticated: false },
    ),

  verifyOtp: (phone: string, code: string, deviceId?: string) =>
    apiRequest<AuthSessionResponse>('/api/v1/auth/otp/verify', {
      method: 'POST',
      body: { phone, code, deviceId },
      authenticated: false,
    }),

  /*
   * Registration and password sign-in.
   *
   * A one-time code is still what proves a number — `register` only sends one,
   * and no account exists until `registerVerify` spends it. The password is a
   * second key to the same door, so that a returning customer does not wait for
   * an SMS on a network where it may not arrive.
   *
   * The name and password are sent twice, once to each call, deliberately: the
   * server keeps nothing between them, so there is never an unverified
   * stranger's password stored against a number they may not own.
   */
  register: (fullName: string, phone: string, password: string) =>
    apiRequest<{ resend_after_seconds: number; expires_in_seconds: number; dev_code?: string }>(
      '/api/v1/auth/register',
      {
        method: 'POST',
        body: { full_name: fullName, phone, password },
        authenticated: false,
      },
    ),

  registerVerify: (
    fullName: string,
    phone: string,
    password: string,
    code: string,
    deviceId?: string,
  ) =>
    apiRequest<AuthSessionResponse>('/api/v1/auth/register/verify', {
      method: 'POST',
      body: { full_name: fullName, phone, password, code, deviceId },
      authenticated: false,
    }),

  phonePasswordSignIn: (phone: string, password: string, deviceId?: string) =>
    apiRequest<AuthSessionResponse>('/api/v1/auth/password/login', {
      method: 'POST',
      body: { phone, password, deviceId },
      authenticated: false,
    }),

  /**
   * Ask for a reset code.
   *
   * Answers the same way whether or not the number has an account, so the
   * screen must say «إن كان الرقم مسجّلاً فقد أرسلنا رمزاً» rather than
   * «أرسلنا رمزاً» — the difference is the whole point of the endpoint.
   */
  forgotPassword: (phone: string) =>
    apiRequest<{ sent: boolean; expires_in_seconds: number }>('/api/v1/auth/password/forgot', {
      method: 'POST',
      body: { phone },
      authenticated: false,
    }),

  resetPassword: (phone: string, code: string, password: string, deviceId?: string) =>
    apiRequest<AuthSessionResponse>('/api/v1/auth/password/reset', {
      method: 'POST',
      body: { phone, code, password, deviceId },
      authenticated: false,
    }),

  /**
   * Sign in with a Google ID token obtained on the device.
   *
   * Google proves who they are, not a number a driver can call — so the answer
   * carries `next_step: 'VERIFY_PHONE'` until one is linked, and the server
   * refuses to quote or place an order before then.
   */
  googleSignIn: (idToken: string, deviceId?: string) =>
    apiRequest<{
      access_token: string;
      refresh_token: string;
      user: {
        id: string;
        is_new_user: boolean;
        profile_completed: boolean;
        phone_verified: boolean;
        modes: ('CUSTOMER' | 'DRIVER')[];
        driver_id: string | null;
      };
      next_step: 'HOME' | 'COMPLETE_PROFILE' | 'VERIFY_PHONE';
    }>('/api/v1/auth/google', {
      method: 'POST',
      body: { id_token: idToken, ...(deviceId ? { deviceId } : {}) },
      authenticated: false,
    }),

  /**
   * Sign in with a username and a password — couriers only, in practice.
   *
   * A driver's account is created by the restaurant that hired them, and the
   * restaurant issues the credentials; there is no OTP to a number that may
   * belong to a shared handset. `client: 'mobile'` is what makes the refresh
   * token come back in the body rather than as a cookie the app cannot read.
   */
  passwordSignIn: (username: string, password: string) =>
    apiRequest<{
      access_token: string;
      refresh_token: string;
      portal: 'ADMIN' | 'RESTAURANT' | 'DRIVER';
      mfa_required: boolean;
      user: { id: string; username: string };
    }>('/api/v1/auth/login', {
      method: 'POST',
      body: { username, password, client: 'mobile' },
      authenticated: false,
    }),

  /** Attach a verified phone to the account already signed in. */
  linkPhone: (phone: string, code: string) =>
    apiRequest<{
      phone_verified: boolean;
      profile_completed: boolean;
      next_step: 'HOME' | 'COMPLETE_PROFILE';
    }>('/api/v1/auth/phone/link', { method: 'POST', body: { phone, code } }),

  governorates: (capability: 'customer_signup' | 'ordering' = 'customer_signup') =>
    apiRequest<GeographyOption[]>(`/api/v1/geography/governorates?capability=${capability}`, {
      authenticated: false,
    }),

  geographyTree: (capability: 'customer_signup' | 'ordering' = 'ordering') =>
    apiRequest<GeographyBranch[]>(`/api/v1/geography/tree?capability=${capability}`, {
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
  /**
   * Merchants in a city, optionally of one kind.
   *
   * `merchantType` is left off by callers that want both — which the server
   * treats as no filter at all, so nothing written before markets existed had
   * to change.
   */
  restaurants: (cityId: string, search?: string, merchantType?: MerchantType) =>
    apiRequest<RestaurantCard[]>(
      `/api/v1/restaurants?city_id=${cityId}` +
        (search ? `&q=${encodeURIComponent(search)}` : '') +
        (merchantType ? `&merchant_type=${merchantType}` : ''),
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
      {
        id: string;
        public_order_number: string;
        status: string;
        customer_total_iqd: number;
        placed_at: string;
        restaurant_name: string | null;
      }[]
    >('/api/v1/orders'),

  /**
   * One restaurant and its whole menu.
   *
   * Public, like discovery — a guest browsing a menu is the case App Store
   * 5.1.1(ii) is about, and the server has always allowed it.
   */
  restaurant: (restaurantId: string) =>
    apiRequest<RestaurantDetail>(`/api/v1/restaurants/${restaurantId}`, { authenticated: false }),

  /**
   * Search dishes across a city.
   *
   * Public, and answers with dishes rather than restaurants: someone typing
   * «دجاج» wants chicken, not a list of places that might have some. Open
   * kitchens come first.
   */
  /** Products in one section — a search in cosmetics never returns a meal. */
  searchDishes: (cityId: string, term: string, merchantType?: MerchantType) =>
    apiRequest<DishResult[]>(
      `/api/v1/menu/search?city_id=${cityId}&q=${encodeURIComponent(term)}` +
        (merchantType ? `&merchant_type=${merchantType}` : ''),
      { authenticated: false },
    ),

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

  /**
   * Returns the new id, not the address.
   *
   * `POST /addresses` answers `{ id }` and always has; the client simply
   * declared `Address` and got away with it because the only caller read
   * `.id`. Editing an address reads the rest, so the lie had to go before it
   * became a crash.
   */
  createAddress: (payload: Record<string, unknown>) =>
    apiRequest<{ id: string }>('/api/v1/addresses', { method: 'POST', body: payload }),

  /**
   * Soft delete — historical orders still point at the row.
   *
   * There is no update endpoint, so editing an address is saving the new one
   * as the default and retiring the old. `POST` clears the previous default
   * inside its own transaction, so the window where neither is default does
   * not exist.
   */
  deleteAddress: (addressId: string) =>
    apiRequest<{ deleted: boolean }>(`/api/v1/addresses/${addressId}`, { method: 'DELETE' }),

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

  /**
   * The assignments a courier is carrying right now.
   *
   * Summaries only — no navigation links, because building a Maps URL for
   * twenty rows to show one is work nobody asked for. The screen asks for the
   * one it is about.
   */
  driverDeliveries: (status: 'active' | 'history' = 'active') =>
    apiRequest<DriverDeliverySummary[]>(`/api/v1/driver/deliveries?status=${status}`),

  /** One assignment, with the Maps and Waze links for it. */
  driverDelivery: (assignmentId: string) =>
    apiRequest<DriverDeliveryTask>(`/api/v1/driver/deliveries/${assignmentId}`),

  /** My application, or null. Reachable while still pending, unlike `/driver/me`. */
  driverMe: () => apiRequest<DriverMe>('/api/v1/driver/me'),

  /** Online or offline — whether the shop sees this courier as assignable. */
  setDriverAvailability: (availability: 'AVAILABLE' | 'OFFLINE') =>
    apiRequest<{ availability: string }>('/api/v1/driver/me/availability', {
      method: 'PATCH',
      body: { availability },
    }),

  /** Presence only: no coordinates are sent or stored (plan §51). */
  driverHeartbeat: () =>
    apiRequest<{ ok: boolean }>('/api/v1/driver/heartbeat', { method: 'POST' }),

  driverCash: () => apiRequest<DriverCash>('/api/v1/driver/cash'),

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
  /*
   * The shape the server actually sends.
   *
   * This declared `delivered_at` and `opens_at` — neither of which exists on
   * the response — and omitted `completed_at`, which does. Nothing caught it
   * because the only caller read the id and the name, so the invented fields
   * were never touched; the first screen to want a date would have received
   * undefined and formatted it into an Invalid Date.
   */
  pendingReviews: () =>
    apiRequest<{ order_id: string; restaurant_name: string; completed_at: string }[]>(
      '/api/v1/reviews/pending',
    ),

  /**
   * The notification feed — every status an order of theirs has reached.
   *
   * Server-derived from the order status history, so it is the same truth the
   * order screen shows and it survives a reinstall. Read state is local.
   */
  notifications: () => apiRequest<OrderNotification[]>('/api/v1/notifications'),

  submitReview: (orderId: string, rating: number, comment?: string) =>
    apiRequest<{ submitted: boolean }>(`/api/v1/orders/${orderId}/review`, {
      method: 'POST',
      body: { rating, ...(comment ? { comment } : {}) },
    }),

  // ── Owner Mode ────────────────────────────────────────────────────────────
  //
  // The same `/restaurant-portal/*` endpoints the web portal calls, from the
  // phone. Not a second API: a parallel namespace would be a second copy of
  // every permission check and every tenant guard, and the two would part
  // company the first time one of them gained a rule.
  //
  // Every write carries `restaurantId`, which the server treats as a selector
  // among shops the session already proves membership of — see RequestOptions.

  /** The live board: new, in the kitchen, ready, on the road, just finished. */
  ownerLiveOrders: (restaurantId: string) =>
    apiRequest<OwnerLiveOrder[]>('/api/v1/restaurant-portal/orders/live', { restaurantId }),

  /**
   * One command on one order. `version` is the order as this phone last saw
   * it: if a second device moved it first, the server refuses rather than
   * overwriting, and the board reloads.
   */
  ownerOrderCommand: (
    restaurantId: string,
    orderId: string,
    command: 'accept' | 'start-preparing' | 'mark-ready',
    version: number,
    /** Accept only: how long the shop needs, which the customer is shown. */
    preparationMinutes?: number,
  ) =>
    apiRequest<{ status: string }>(`/api/v1/restaurant-portal/orders/${orderId}/${command}`, {
      method: 'POST',
      restaurantId,
      body: {
        expected_version: version,
        ...(command === 'accept' && preparationMinutes
          ? { estimated_preparation_minutes: preparationMinutes }
          : {}),
      },
    }),

  ownerRejectOrder: (
    restaurantId: string,
    orderId: string,
    reason: OwnerRejectReason,
    version: number,
  ) =>
    apiRequest<{ status: string }>(`/api/v1/restaurant-portal/orders/${orderId}/reject`, {
      method: 'POST',
      restaurantId,
      body: { reason, expected_version: version },
    }),

  ownerEligibleDrivers: (restaurantId: string) =>
    apiRequest<OwnerEligibleDriver[]>('/api/v1/restaurant-portal/drivers/eligible', {
      restaurantId,
    }),

  ownerAssignDriver: (restaurantId: string, orderId: string, driverId: string) =>
    apiRequest<{ assignment_id: string }>(
      `/api/v1/restaurant-portal/orders/${orderId}/assign-driver`,
      { method: 'POST', restaurantId, body: { driver_id: driverId } },
    ),

  /** Take an order back from a courier who has not collected it yet. */
  ownerUnassignDriver: (restaurantId: string, orderId: string, reason: string) =>
    apiRequest<{ unassigned: boolean }>(
      `/api/v1/restaurant-portal/orders/${orderId}/unassign-driver`,
      { method: 'POST', restaurantId, body: { reason } },
    ),

  /** The shops this account belongs to, with the role held in each. */
  ownerShops: () =>
    apiRequest<{
      user: { id: string; full_name: string | null };
      restaurants: OwnerShop[];
    }>('/api/v1/restaurant-portal/me'),

  /** The whole product tree for one shop. */
  ownerCatalog: (restaurantId: string) =>
    apiRequest<OwnerCatalog>('/api/v1/restaurant-portal/menu', { restaurantId }),

  ownerCreateCategory: (restaurantId: string, body: { name_ar: string; sort_order?: number }) =>
    apiRequest<{ id: string }>('/api/v1/restaurant-portal/menu/categories', {
      method: 'POST',
      restaurantId,
      body: { sort_order: 0, ...body },
    }),

  ownerCreateProduct: (restaurantId: string, body: OwnerProductInput) =>
    apiRequest<{ id: string }>('/api/v1/restaurant-portal/menu/items', {
      method: 'POST',
      restaurantId,
      body,
    }),

  ownerUpdateProduct: (restaurantId: string, itemId: string, body: Partial<OwnerProductInput>) =>
    apiRequest<{ updated: boolean }>(`/api/v1/restaurant-portal/menu/items/${itemId}`, {
      method: 'PATCH',
      restaurantId,
      body,
    }),

  ownerDeleteProduct: (restaurantId: string, itemId: string) =>
    apiRequest<{ deleted: boolean }>(`/api/v1/restaurant-portal/menu/items/${itemId}`, {
      method: 'DELETE',
      restaurantId,
    }),

  /**
   * Store an image and get its id back.
   *
   * `data` is a base64 data URL. The caller shrinks it first — see
   * `src/lib/upload.ts` — because a phone photograph posted raw is several
   * megabytes against a five-megabyte ceiling.
   */
  ownerUploadImage: (
    restaurantId: string,
    data: string,
    purpose: 'MENU_ITEM' | 'RESTAURANT_LOGO' | 'RESTAURANT_COVER',
  ) =>
    apiRequest<{ asset_id: string; url: string }>('/api/v1/uploads', {
      method: 'POST',
      restaurantId,
      body: { data, purpose, restaurant_id: restaurantId },
    }),
};
