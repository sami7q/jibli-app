import { ERROR_MESSAGES_AR, type ErrorCode, type GeographyCapability } from '@jibli/contracts';

/**
 * API client for the Admin Portal.
 *
 * Mutations here change platform coverage and approve businesses, so every one
 * of them is a named command with its own endpoint — there is no generic patch
 * helper to reach for (plan §67, §69).
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

  /** The server demands a fresh MFA challenge for this action (plan §88). */
  get needsReauth(): boolean {
    return this.code === 'REAUTHENTICATION_REQUIRED' || this.code === 'MFA_REQUIRED';
  }
}

interface Envelope<T> {
  data: T;
  meta: Record<string, unknown>;
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  readonly accessToken?: string | null;
  readonly signal?: AbortSignal;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'include',
    ...(options.signal ? { signal: options.signal } : {}),
  });

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
      /* a gateway page or truncated body still needs a usable message */
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

// ── Types ──────────────────────────────────────────────────────────────────

export interface AdminGovernorate {
  id: string;
  code: string;
  name_ar: string;
  is_enabled: boolean;
  customer_signup_enabled: boolean;
  restaurant_onboarding_enabled: boolean;
  ordering_enabled: boolean;
}

export interface AdminCity extends AdminGovernorate {
  governorate_id: string;
}

/** One row of the coverage matrix (plan §127). */
export interface CoverageRow {
  governorate_name_ar: string;
  city_id: string;
  city_name_ar: string;
  customer_signup: boolean;
  restaurant_onboarding: boolean;
  ordering: boolean;
  approved_restaurants: number;
  active_restaurants: number;
  customers: number;
}

export interface CoverageImpact {
  active_restaurants: number;
  active_orders: number;
  customer_profiles: number;
  note_ar: string;
}

export interface RestaurantApplication {
  id: string;
  display_name: string;
  contact_phone: string;
  governorate_name_ar: string;
  city_name_ar: string;
  address_text: string;
  status: string;
  created_at: string;
  coverage_warning: boolean;
}

export interface ReadinessCheck {
  key: string;
  label_ar: string;
  passed: boolean;
  blocking: boolean;
}

export interface AuditEntry {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor: string | null;
  reason: string | null;
  created_at: string;
  request_id: string | null;
}

export type CapabilityPatch = Partial<Record<`${GeographyCapability}_enabled` | 'is_enabled', boolean>> & {
  reason?: string;
};

// ── Endpoints ──────────────────────────────────────────────────────────────

export const adminApi = {
  /** Posts a data URL and returns the stored asset. Shared shape with the restaurant portal. */
  uploadImage: (
    token: string,
    body: { data: string; purpose?: 'RESTAURANT_LOGO' | 'RESTAURANT_COVER'; restaurant_id?: string },
  ) =>
    apiRequest<{ asset_id: string; url: string; content_type: string; byte_size: number }>(
      '/api/v1/uploads',
      { method: 'POST', accessToken: token, body },
    ),

  governorates: (token: string) =>
    apiRequest<AdminGovernorate[]>('/api/v1/admin/geography/governorates', {
      accessToken: token,
    }),

  cities: (token: string, governorateId?: string) =>
    apiRequest<AdminCity[]>(
      `/api/v1/admin/geography/cities${governorateId ? `?governorate_id=${governorateId}` : ''}`,
      { accessToken: token },
    ),

  coverageSummary: (token: string) =>
    apiRequest<CoverageRow[]>('/api/v1/admin/geography/coverage-summary', {
      accessToken: token,
    }),

  /** Impact preview — always shown before a disable is confirmed (plan §114). */
  cityImpact: (token: string, cityId: string) =>
    apiRequest<CoverageImpact>(`/api/v1/admin/geography/cities/${cityId}/impact`, {
      accessToken: token,
    }),

  updateGovernorate: (token: string, governorateId: string, patch: CapabilityPatch) =>
    apiRequest<{ updated: boolean }>(`/api/v1/admin/geography/governorates/${governorateId}`, {
      method: 'PATCH',
      accessToken: token,
      body: patch,
    }),

  updateCity: (token: string, cityId: string, patch: CapabilityPatch) =>
    apiRequest<{ updated: boolean }>(`/api/v1/admin/geography/cities/${cityId}`, {
      method: 'PATCH',
      accessToken: token,
      body: patch,
    }),

  applications: (token: string, status?: string) =>
    apiRequest<RestaurantApplication[]>(
      `/api/v1/admin/restaurants/applications${status ? `?status=${status}` : ''}`,
      { accessToken: token },
    ),

  approveApplication: (
    token: string,
    applicationId: string,
    payload: {
      commission_flat_iqd?: number;
      settlement_policy?: 'HALF_MONTH' | 'MONTHLY';
      override_coverage?: boolean;
      reason?: string;
    },
  ) =>
    apiRequest<{ restaurant_id: string; branch_id: string }>(
      `/api/v1/admin/restaurants/applications/${applicationId}/approve`,
      { method: 'POST', accessToken: token, body: payload },
    ),

  rejectApplication: (token: string, applicationId: string, reason: string) =>
    apiRequest<{ rejected: boolean }>(
      `/api/v1/admin/restaurants/applications/${applicationId}/reject`,
      { method: 'POST', accessToken: token, body: { reason } },
    ),

  readiness: (token: string, restaurantId: string) =>
    apiRequest<{ ready: boolean; checks: ReadinessCheck[]; blocking_failures: string[] }>(
      `/api/v1/admin/restaurants/${restaurantId}/readiness`,
      { accessToken: token },
    ),

  auditLogs: (token: string, filters: { entity_type?: string; action?: string } = {}) => {
    const params = new URLSearchParams();
    if (filters.entity_type) params.set('entity_type', filters.entity_type);
    if (filters.action) params.set('action', filters.action);
    const query = params.toString();
    return apiRequest<AuditEntry[]>(`/api/v1/admin/audit-logs${query ? `?${query}` : ''}`, {
      accessToken: token,
    });
  },
};
