import { ERROR_MESSAGES_AR, type ErrorCode } from '@jibli/contracts';

/**
 * API client for the Restaurant Portal.
 *
 * Errors arrive as the envelope of plan §66: the client branches on the stable
 * `code` and shows the Arabic `message`. It never invents its own wording for a
 * business condition the server already named (plan §113).
 */

/**
 * Where API calls go.
 *
 * Empty string means "this origin", which is what a deployment behind the
 * Next rewrite wants: the request goes to the portal's own domain, so the
 * refresh cookie is first-party and no CORS preflight happens. Set
 * NEXT_PUBLIC_API_PROXY=1 alongside API_ORIGIN to turn that on.
 *
 * Without it, calls go straight to the API origin — the local-development
 * arrangement, where both run on localhost.
 */
const API_BASE =
  process.env.NEXT_PUBLIC_API_PROXY === '1'
    ? ''
    : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000');

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

  /** Conditions the UI can recover from by refreshing rather than erroring. */
  get isStaleState(): boolean {
    return this.code === 'ORDER_ALREADY_UPDATED' || this.code === 'CONFLICT';
  }

  get requiresReauth(): boolean {
    return (
      this.code === 'UNAUTHENTICATED' ||
      this.code === 'SESSION_EXPIRED' ||
      this.code === 'PERMISSION_REVOKED'
    );
  }
}

export interface Envelope<T> {
  data: T;
  meta: Record<string, unknown>;
}

interface ErrorEnvelopeShape {
  error: {
    code: ErrorCode;
    message: string;
    details: Record<string, unknown>;
    request_id: string;
  };
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  readonly accessToken?: string | null;
  readonly restaurantId?: string | null;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
}

/**
 * Like `apiRequest`, but keeps the envelope's `meta`.
 *
 * Some endpoints put a server-computed total next to a *paginated* list — the
 * sum of every matching row, not just the page. Recomputing it from the rows on
 * screen would report a smaller number and look like a bug in the books, so
 * those screens read it from meta instead (plan §66).
 */
export async function apiRequestWithMeta<T>(
  path: string,
  options: RequestOptions = {},
): Promise<Envelope<T>> {
  return requestEnvelope<T>(path, options);
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const envelope = await requestEnvelope<T>(path, options);
  return envelope.data;
}

async function requestEnvelope<T>(path: string, options: RequestOptions = {}): Promise<Envelope<T>> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;
  // The server still verifies membership; this only selects among restaurants
  // the session already proves access to (plan §63).
  if (options.restaurantId) headers['X-Restaurant-Id'] = options.restaurantId;
  if (options.idempotencyKey) headers['X-Idempotency-Key'] = options.idempotencyKey;

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'include',
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) {
    let envelope: ErrorEnvelopeShape | null = null;
    try {
      envelope = (await response.json()) as ErrorEnvelopeShape;
    } catch {
      // A non-JSON error body (a gateway page, say) still needs a usable message.
    }

    const code = (envelope?.error.code ?? 'INTERNAL_ERROR') as ErrorCode;
    throw new ApiError(
      code,
      envelope?.error.message ?? ERROR_MESSAGES_AR[code] ?? ERROR_MESSAGES_AR.INTERNAL_ERROR,
      envelope?.error.details ?? {},
      response.status,
      envelope?.error.request_id ?? '',
    );
  }

  if (response.status === 204) return { data: undefined as T, meta: {} };

  return (await response.json()) as Envelope<T>;
}

/** Generate an idempotency key for a money-moving command (plan §28). */
export function newIdempotencyKey(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

// ── Typed endpoints ────────────────────────────────────────────────────────

export interface LiveOrderItem {
  id: string;
  name_ar: string;
  quantity: number;
  unit_price_iqd: number;
  line_total_iqd: number;
  notes: string | null;
  modifiers: { name_ar: string; price_iqd: number }[];
}

export interface LiveOrder {
  id: string;
  public_order_number: string;
  status: string;
  age_minutes: number;
  placed_at: string;
  customer_name: string;
  customer_phone: string;
  customer_notes: string | null;
  payment_method: string;
  payment_status: string;
  items_subtotal_iqd: number;
  delivery_fee_iqd: number;
  customer_total_iqd: number;
  commission_amount_iqd: number;
  version: number;
  delivery_address: Record<string, unknown>;
  driver: { name: string; assignment_status: string } | null;
  items: LiveOrderItem[];
}


export interface EligibleDriver {
  id: string;
  name: string;
  phone: string;
  availability: string;
  vehicle_type: string;
  can_collect_cash: boolean;
  active_assignments: number;
  assignable: boolean;
}


export const restaurantApi = {
  liveOrders: (auth: { accessToken: string; restaurantId: string }, signal?: AbortSignal) =>
    apiRequest<LiveOrder[]>('/api/v1/restaurant-portal/orders/live', {
      accessToken: auth.accessToken,
      restaurantId: auth.restaurantId,
      ...(signal ? { signal } : {}),
    }),



  eligibleDrivers: (auth: { accessToken: string; restaurantId: string }) =>
    apiRequest<EligibleDriver[]>('/api/v1/restaurant-portal/drivers/eligible', {
      accessToken: auth.accessToken,
      restaurantId: auth.restaurantId,
    }),

  acceptOrder: (
    auth: { accessToken: string; restaurantId: string },
    orderId: string,
    expectedVersion: number,
  ) =>
    apiRequest<{ status: string }>(`/api/v1/restaurant-portal/orders/${orderId}/accept`, {
      method: 'POST',
      accessToken: auth.accessToken,
      restaurantId: auth.restaurantId,
      // Optimistic concurrency: a stale board cannot overwrite a newer state.
      body: { expected_version: expectedVersion },
    }),

  rejectOrder: (
    auth: { accessToken: string; restaurantId: string },
    orderId: string,
    payload: { reason: string; note?: string; expectedVersion: number },
  ) =>
    apiRequest<{ status: string }>(`/api/v1/restaurant-portal/orders/${orderId}/reject`, {
      method: 'POST',
      accessToken: auth.accessToken,
      restaurantId: auth.restaurantId,
      body: {
        reason: payload.reason,
        note: payload.note,
        expected_version: payload.expectedVersion,
      },
    }),

  startPreparing: (
    auth: { accessToken: string; restaurantId: string },
    orderId: string,
    expectedVersion: number,
  ) =>
    apiRequest<{ status: string }>(`/api/v1/restaurant-portal/orders/${orderId}/start-preparing`, {
      method: 'POST',
      accessToken: auth.accessToken,
      restaurantId: auth.restaurantId,
      body: { expected_version: expectedVersion },
    }),

  markReady: (
    auth: { accessToken: string; restaurantId: string },
    orderId: string,
    expectedVersion: number,
  ) =>
    apiRequest<{ status: string }>(`/api/v1/restaurant-portal/orders/${orderId}/mark-ready`, {
      method: 'POST',
      accessToken: auth.accessToken,
      restaurantId: auth.restaurantId,
      body: { expected_version: expectedVersion },
    }),

  assignDriver: (
    auth: { accessToken: string; restaurantId: string },
    orderId: string,
    driverId: string,
  ) =>
    apiRequest<{ assignment_id: string }>(
      `/api/v1/restaurant-portal/orders/${orderId}/assign-driver`,
      {
        method: 'POST',
        accessToken: auth.accessToken,
        restaurantId: auth.restaurantId,
        body: { driver_id: driverId },
      },
    ),
};
