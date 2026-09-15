import { apiRequest } from './api';

/**
 * Admin endpoint bindings beyond geography and applications.
 *
 * Kept separate from `api.ts` so the transport concerns (error envelope, auth
 * header, token handling) stay in one small file and the endpoint surface can
 * grow without it.
 */

export interface AdminRestaurant {
  id: string;
  display_name: string;
  /**
   * RESTAURANT or MARKET.
   *
   * Optional so the page still renders against an API deployed before the
   * column existed; the directory falls back to RESTAURANT rather than showing
   * an empty badge on every row.
   */
  merchant_type?: 'RESTAURANT' | 'MARKET';
  /** Keys from CUISINES. Free text on rows created before the vocabulary existed. */
  cuisine_tags: string[];
  partner_code: string;
  onboarding_status: string;
  operational_status: string;
  rating: number | null;
  rating_count: number;
  city_name_ar: string | null;
  governorate_name_ar: string | null;
  branch_active: boolean;
  accepts_orders: boolean;
  city_ordering_enabled: boolean;
  has_portal_user: boolean;
  commission_flat_iqd: number | null;
  commission_display: string | null;
  orders_7d: number;
  created_at: string;
}

/** Restaurants counted per governorate and city, for the coverage panel. */
export interface AreaCoverage {
  id: string;
  name_ar: string;
  is_enabled: boolean;
  ordering_enabled: boolean;
  total: number;
  active: number;
  accepting: number;
  cities: {
    id: string;
    name_ar: string;
    is_enabled: boolean;
    ordering_enabled: boolean;
    total: number;
    active: number;
    accepting: number;
  }[];
}

/** Commission earned and outstanding, grouped three ways over one filtered set. */
export interface AppCategory {
  id: string;
  key: string;
  name_ar: string;
  emoji: string | null;
  image_asset_id: string | null;
  sort_order: number;
  is_active: boolean;
  restaurant_count: number;
}

export interface AppBanner {
  id: string;
  title_ar: string;
  subtitle_ar: string | null;
  image_asset_id: string | null;
  link_type: 'NONE' | 'CATEGORY' | 'RESTAURANT' | 'URL';
  link_value: string | null;
  sort_order: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  is_live: boolean;
}

export interface Collectable {
  restaurant_id: string;
  display_name: string;
  partner_code: string;
  order_count: number;
  commission_iqd: number;
  gross_sales_iqd: number;
  oldest_order_at: string | null;
  newest_order_at: string | null;
}

export interface CollectionArchive {
  total_collected_iqd: number;
  collections: {
    settlement_id: string;
    restaurant_id: string;
    restaurant_name: string;
    partner_code: string;
    period_start: string;
    period_end: string;
    order_count: number;
    gross_sales_iqd: number;
    amount_iqd: number;
    collected_at: string | null;
    method: string | null;
    reference: string | null;
    recorded_by: string | null;
  }[];
}

export interface AdminNotification {
  id: string;
  kind: string;
  severity: 'INFO' | 'ATTENTION' | 'URGENT';
  title_ar: string;
  body_ar: string | null;
  link_path: string | null;
  is_read: boolean;
  created_at: string;
}

export interface SupportThreadSummary {
  id: string;
  subject: string;
  topic: string;
  status: 'OPEN' | 'ANSWERED' | 'RESOLVED';
  priority: 'NORMAL' | 'URGENT';
  restaurant_id: string;
  restaurant_name: string;
  partner_code: string;
  last_message_at: string;
  last_message_from: 'RESTAURANT' | 'JIBLI';
  awaiting_jibli: boolean;
  message_count: number;
  created_at: string;
}

export interface SupportThreadDetail {
  id: string;
  subject: string;
  topic: string;
  status: 'OPEN' | 'ANSWERED' | 'RESOLVED';
  priority: 'NORMAL' | 'URGENT';
  restaurant_id: string;
  restaurant_name: string;
  partner_code: string;
  created_at: string;
  resolved_at: string | null;
  messages: {
    id: string;
    side: 'RESTAURANT' | 'JIBLI';
    author_name: string;
    body: string;
    created_at: string;
  }[];
}

export interface AdminReview {
  id: string;
  rating: number;
  comment: string | null;
  is_hidden: boolean;
  restaurant_id: string;
  restaurant_name: string;
  public_order_number: string;
  author_name: string | null;
  created_at: string;
}

export interface CommissionOverview {
  totals: {
    order_count: number;
    restaurant_count: number;
    gross_sales_iqd: number;
    commission_iqd: number;
    outstanding_iqd: number;
  };
  by_area: {
    id: string;
    name_ar: string;
    order_count: number;
    commission_iqd: number;
    outstanding_iqd: number;
    gross_sales_iqd: number;
    cities: {
      id: string;
      name_ar: string;
      order_count: number;
      commission_iqd: number;
      outstanding_iqd: number;
      gross_sales_iqd: number;
    }[];
  }[];
  by_restaurant: {
    restaurant_id: string;
    display_name: string;
    partner_code: string;
    governorate_name_ar: string;
    city_name_ar: string;
    order_count: number;
    gross_sales_iqd: number;
    commission_iqd: number;
    outstanding_iqd: number;
    last_order_at: string | null;
  }[];
  truncated: boolean;
}

export interface CommissionConfigView {
  flat_iqd: number;
  commission_display: string;
  settlement_policy: string;
  payment_term_days: number;
  effective_from: string;
  effective_to: string | null;
  is_current: boolean;
}

export interface AdminRestaurantDetail {
  id: string;
  display_name: string;
  legal_name: string | null;
  partner_code: string;
  description_ar: string | null;
  onboarding_status: string;
  operational_status: string;
  cuisine_tags: string[];
  rating: number | null;
  rating_count: number;
  minimum_order_iqd: number;
  suspended_reason: string | null;
  approved_at: string | null;
  branch: {
    id: string;
    name: string;
    address_text: string;
    city_name_ar: string | null;
    governorate_name_ar: string | null;
    latitude: number | null;
    longitude: number | null;
    phone: string | null;
    is_active: boolean;
    accepts_orders: boolean;
    delivery_fee_iqd: number;
  } | null;
  city_ordering_enabled: boolean;
  commission_history: CommissionConfigView[];
  staff: {
    user_id: string;
    name: string | null;
    phone: string;
    role: string;
    is_active: boolean;
  }[];
}

export interface AdminOrder {
  id: string;
  public_order_number: string;
  status: string;
  payment_status: string;
  customer_total_iqd: number;
  commission_amount_iqd: number;
  placed_at: string;
  completed_at: string | null;
  customer_name: string;
  customer_phone: string;
  phone_masked: boolean;
  restaurant_id: string;
  restaurant_name: string;
  city_name_ar: string;
  driver_name: string | null;
}

export interface AdminOrderDetail extends AdminOrder {
  items_subtotal_iqd: number;
  delivery_fee_iqd: number;
  platform_service_fee_iqd: number;
  discount_total_iqd: number;
  commission_base_iqd: number;
  commission_flat_iqd: number;
  restaurant_net_iqd: number;
  customer_notes: string | null;
  cancellation_reason: string | null;
  rejection_reason: string | null;
  version: number;
  delivery_address: Record<string, unknown>;
  items: {
    name_ar: string;
    quantity: number;
    unit_price_iqd: number;
    line_total_iqd: number;
    notes: string | null;
  }[];
  timeline: {
    from_status: string | null;
    to_status: string;
    actor_type: string;
    actor_name: string | null;
    reason: string | null;
    at: string;
  }[];
  assignments: {
    id: string;
    status: string;
    driver_name: string | null;
    assigned_at: string;
    accepted_at: string | null;
    picked_up_at: string | null;
    delivered_at: string | null;
    rejection_reason: string | null;
  }[];
}

export interface OrderStats {
  orders_total: number;
  orders_completed: number;
  orders_cancelled: number;
  orders_live: number;
  average_order_iqd: number;
  completion_rate: number;
  gmv_iqd: number;
  commission_accrued_iqd: number;
  service_fee_revenue_iqd: number;
}

export interface AdminCustomer {
  id: string;
  full_name: string | null;
  /** Restaurants this person runs. Empty for an ordinary customer. */
  restaurants: {
    id: string;
    display_name: string;
    partner_code: string;
    operational_status: string;
    role: string;
    is_active: boolean;
  }[];
  phone: string;
  phone_masked: boolean;
  status: string;
  profile_completed: boolean;
  city_name_ar: string | null;
  order_count: number;
  lifetime_spend_iqd: number;
  created_at: string;
  last_login_at: string | null;
}

export interface AdminDriver {
  id: string;
  full_name: string | null;
  phone: string;
  phone_masked: boolean;
  status: string;
  availability: string;
  vehicle_type: string;
  restaurant_id: string | null;
  restaurant_name: string | null;
  active_assignments: number;
  completed_deliveries: number;
  cash_custody_iqd: number;
  last_seen_at: string | null;
}

export interface AdminSettlement {
  id: string;
  restaurant_id: string;
  restaurant_name: string;
  partner_code: string;
  policy: string;
  period_start: string;
  period_end: string;
  status: string;
  order_count: number;
  gross_sales_iqd: number;
  commission_total_iqd: number;
  adjustments_total_iqd: number;
  amount_due_iqd: number;
  amount_paid_iqd: number;
  remaining_iqd: number;
  due_date: string | null;
  issued_at: string | null;
  days_overdue: number;
}

export interface AdminSettlementDetail extends AdminSettlement {
  commission_base_total_iqd: number;
  void_reason: string | null;
  dispute_reason: string | null;
  reconciles: boolean;
  reconciliation_detail: string | null;
  lines: {
    order_id: string;
    public_order_number: string;
    commission_base_iqd: number;
    commission_flat_iqd: number;
    commission_amount_iqd: number;
    completed_at: string;
  }[];
  payments: {
    id: string;
    amount_iqd: number;
    method: string;
    reference: string | null;
    paid_at: string;
    note: string | null;
    recorded_by: string | null;
    is_reversal: boolean;
  }[];
  adjustments: {
    id: string;
    amount_iqd: number;
    reason: string;
    approved_by: string | null;
    created_at: string;
  }[];
}

export interface FinanceSummary {
  commission_accrued_iqd: number;
  commission_collected_iqd: number;
  credits_issued_iqd: number;
  service_fee_revenue_iqd: number;
  outstanding_iqd: number;
  outstanding_settlements: number;
  overdue_iqd: number;
  overdue_settlements: number;
  reconciliation: {
    check: string;
    business_date: string;
    passed: boolean;
    variance_iqd: number | null;
  }[];
  definitions_ar: Record<string, string>;
}

export interface ConfigEntry {
  key: string;
  value: unknown;
  is_default: boolean;
  description_ar: string | null;
  is_sensitive: boolean;
  reason_required: boolean;
  updated_at: string | null;
}

export interface StaffMember {
  user_id: string;
  full_name: string | null;
  phone: string;
  status: string;
  mfa_enabled: boolean;
  mfa_required: boolean;
  roles: string[];
}

export interface RoleMatrix {
  platform_roles: {
    role: string;
    permissions: string[];
    permission_count: number;
    mfa_mandatory: boolean;
  }[];
  restaurant_roles: { role: string; permissions: string[]; permission_count: number }[];
  all_admin_permissions: string[];
  reauthentication_required: string[];
  note_ar: string;
}

export interface MfaStatus {
  enabled: boolean;
  required: boolean;
  enrolment_pending: boolean;
  recovery_codes_remaining: number;
  enabled_at: string | null;
}

/** Build a query string, dropping empty values so the URL stays clean. */
function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export interface AdminOverview {
  commission_today_iqd: number;
  commission_delta: number | null;
  sales_today_iqd: number;
  sales_delta: number | null;
  orders_today: number;
  orders_delta: number | null;
  active_users: number;
  users_delta: number | null;
  active_restaurants: number;
  restaurants_delta: number | null;
  live_orders: number;
  open_applications: number;
  status_distribution: {
    completed: number;
    delivering: number;
    preparing: number;
    cancelled: number;
    total: number;
  };
  sales_series: { date: string; label: string; value: number }[];
  commission_series: { date: string; label: string; value: number }[];
  performance: {
    average_order_iqd: number;
    average_delivery_minutes: number;
    cancellation_rate_percent: number;
  };
  top_restaurants: { id: string; name: string; order_count: number; revenue_iqd: number }[];
  top_categories: { name_ar: string; order_count: number }[];
  recent_orders: {
    id: string;
    public_order_number: string;
    restaurant_name: string;
    customer_name: string;
    total_iqd: number;
    status: string;
    placed_at: string;
  }[];
  pending_applications: {
    id: string;
    display_name: string;
    city_name_ar: string;
    governorate_name_ar: string;
    submitted_at: string;
  }[];
  activity: {
    id: string;
    action: string;
    entity_type: string;
    actor_name: string | null;
    created_at: string;
  }[];
}

export interface AdminCoupon {
  id: string;
  code: string;
  type: string;
  value: number;
  max_discount_iqd: number | null;
  minimum_order_iqd: number;
  funding_source: string;
  restaurant_share_bps: number | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
  total_usage_limit: number | null;
  per_user_usage_limit: number;
  usage_count: number;
  discount_given_iqd: number;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  state: string;
}

export interface PortalUser {
  member_id: string;
  user_id: string;
  username: string | null;
  full_name: string | null;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  mfa_enabled: boolean;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
}

export const admin = {
  /** Everything the home screen shows, in one round trip (plan §130). */
  overview: (token: string) =>
    apiRequest<AdminOverview>('/api/v1/admin/dashboard/overview', { accessToken: token }),

  // ── Coupons (plan §60) ──────────────────────────────────────────────────
  coupons: (token: string, status?: string) =>
    apiRequest<AdminCoupon[]>(`/api/v1/admin/coupons${status ? `?status=${status}` : ''}`, {
      accessToken: token,
    }),

  createCoupon: (token: string, body: unknown) =>
    apiRequest<{ id: string }>('/api/v1/admin/coupons', {
      accessToken: token,
      method: 'POST',
      body,
    }),

  setCouponActive: (token: string, id: string, isActive: boolean, reason: string) =>
    apiRequest<{ updated: boolean }>(`/api/v1/admin/coupons/${id}`, {
      accessToken: token,
      method: 'PATCH',
      body: { is_active: isActive, reason },
    }),

  // ── Restaurant portal credentials (plan §69, §1854) ─────────────────────
  portalUsers: (token: string, restaurantId: string) =>
    apiRequest<PortalUser[]>(`/api/v1/admin/restaurants/${restaurantId}/portal-users`, {
      accessToken: token,
    }),

  suggestUsername: (token: string, restaurantId: string) =>
    apiRequest<{ username: string }>(
      `/api/v1/admin/restaurants/${restaurantId}/portal-users/suggest`,
      { accessToken: token },
    ),

  /** The password in the response is shown once and never retrievable again. */
  createPortalUser: (
    token: string,
    restaurantId: string,
    body: { username: string; full_name: string; role?: string },
  ) =>
    apiRequest<{ user_id: string; username: string; password: string; note_ar: string }>(
      `/api/v1/admin/restaurants/${restaurantId}/portal-users`,
      { accessToken: token, method: 'POST', body },
    ),

  resetPortalPassword: (token: string, userId: string, reason: string) =>
    apiRequest<{ password: string; note_ar: string }>(
      `/api/v1/admin/portal-users/${userId}/reset-password`,
      { accessToken: token, method: 'POST', body: { reason } },
    ),

  setPortalUserActive: (token: string, userId: string, isActive: boolean, reason: string) =>
    apiRequest<{ updated: boolean }>(`/api/v1/admin/portal-users/${userId}`, {
      accessToken: token,
      method: 'PATCH',
      body: { is_active: isActive, reason },
    }),

  // ── Restaurants ─────────────────────────────────────────────────────────
  restaurants: (token: string, filters: Record<string, string | undefined> = {}) =>
    apiRequest<AdminRestaurant[]>(`/api/v1/admin/restaurants${qs(filters)}`, {
      accessToken: token,
    }),

  restaurant: (token: string, id: string) =>
    apiRequest<AdminRestaurantDetail>(`/api/v1/admin/restaurants/${id}`, { accessToken: token }),

  createRestaurant: (token: string, body: unknown) =>
    apiRequest<{ restaurant_id: string; branch_id: string; owner_user_id: string }>(
      '/api/v1/admin/restaurants',
      { method: 'POST', accessToken: token, body },
    ),

  suspendRestaurant: (token: string, id: string, reason: string) =>
    apiRequest<{ suspended: boolean }>(`/api/v1/admin/restaurants/${id}/suspend`, {
      method: 'POST',
      accessToken: token,
      body: { reason },
    }),

  activateRestaurant: (token: string, id: string) =>
    apiRequest<{ activated: boolean }>(`/api/v1/admin/restaurants/${id}/activate`, {
      method: 'POST',
      accessToken: token,
    }),

  updateCommission: (
    token: string,
    id: string,
    body: { commission_flat_iqd: number; reason: string },
  ) =>
    apiRequest<{ updated: boolean; note_ar: string }>(
      `/api/v1/admin/restaurants/${id}/commission`,
      { method: 'PATCH', accessToken: token, body },
    ),

  readiness: (token: string, id: string) =>
    apiRequest<{
      ready: boolean;
      checks: { key: string; label_ar: string; passed: boolean; blocking: boolean }[];
      blocking_failures: string[];
    }>(`/api/v1/admin/restaurants/${id}/readiness`, { accessToken: token }),

  // ── Orders ──────────────────────────────────────────────────────────────
  orders: (token: string, filters: Record<string, string | number | undefined> = {}) =>
    apiRequest<AdminOrder[]>(`/api/v1/admin/orders${qs(filters)}`, { accessToken: token }),

  order: (token: string, id: string) =>
    apiRequest<AdminOrderDetail>(`/api/v1/admin/orders/${id}`, { accessToken: token }),

  orderStats: (token: string, days = 1) =>
    apiRequest<OrderStats>(`/api/v1/admin/orders/stats?days=${days}`, { accessToken: token }),

  cancelOrder: (token: string, id: string, reason: string) =>
    apiRequest<{ cancelled: boolean }>(`/api/v1/admin/orders/${id}/cancel`, {
      method: 'POST',
      accessToken: token,
      body: { reason },
    }),

  // ── People ──────────────────────────────────────────────────────────────
  customers: (token: string, filters: Record<string, string | undefined> = {}) =>
    apiRequest<AdminCustomer[]>(`/api/v1/admin/users${qs(filters)}`, { accessToken: token }),

  commissionOverview: (token: string, filters: Record<string, string | undefined> = {}) =>
    apiRequest<CommissionOverview>(`/api/v1/admin/finance/commission-overview${qs(filters)}`, {
      accessToken: token,
    }),

  // ── Categories and banners ────────────────────────────────────────────────

  categories: (token: string) =>
    apiRequest<AppCategory[]>('/api/v1/admin/categories', { accessToken: token }),

  createCategory: (
    token: string,
    body: { key: string; name_ar: string; emoji?: string; image_asset_id?: string },
  ) =>
    apiRequest<{ id: string }>('/api/v1/admin/categories', {
      method: 'POST',
      accessToken: token,
      body,
    }),

  updateCategory: (
    token: string,
    id: string,
    body: {
      name_ar?: string;
      emoji?: string | null;
      image_asset_id?: string | null;
      is_active?: boolean;
    },
  ) =>
    apiRequest<{ updated: boolean }>(`/api/v1/admin/categories/${id}`, {
      method: 'PATCH',
      accessToken: token,
      body,
    }),

  deleteCategory: (token: string, id: string) =>
    apiRequest<{ deleted: boolean }>(`/api/v1/admin/categories/${id}`, {
      method: 'DELETE',
      accessToken: token,
    }),

  reorderCategories: (token: string, ids: string[]) =>
    apiRequest<{ ordered: number }>('/api/v1/admin/categories/order', {
      method: 'POST',
      accessToken: token,
      body: { ids },
    }),

  banners: (token: string) =>
    apiRequest<AppBanner[]>('/api/v1/admin/banners', { accessToken: token }),

  createBanner: (token: string, body: Record<string, unknown>) =>
    apiRequest<{ id: string }>('/api/v1/admin/banners', {
      method: 'POST',
      accessToken: token,
      body,
    }),

  updateBanner: (token: string, id: string, body: Record<string, unknown>) =>
    apiRequest<{ updated: boolean }>(`/api/v1/admin/banners/${id}`, {
      method: 'PATCH',
      accessToken: token,
      body,
    }),

  deleteBanner: (token: string, id: string) =>
    apiRequest<{ deleted: boolean }>(`/api/v1/admin/banners/${id}`, {
      method: 'DELETE',
      accessToken: token,
    }),

  reorderBanners: (token: string, ids: string[]) =>
    apiRequest<{ ordered: number }>('/api/v1/admin/banners/order', {
      method: 'POST',
      accessToken: token,
      body: { ids },
    }),

  // ── Collecting commission ─────────────────────────────────────────────────

  collectable: (token: string) =>
    apiRequest<Collectable[]>('/api/v1/admin/finance/collectable', { accessToken: token }),

  collect: (
    token: string,
    body: { restaurant_id: string; method: string; reference?: string; note?: string },
  ) =>
    apiRequest<{
      settlement_id: string;
      order_count: number;
      collected_iqd: number;
      note_ar: string;
    }>('/api/v1/admin/finance/collect', { method: 'POST', accessToken: token, body }),

  collections: (token: string, filters: Record<string, string | undefined> = {}) =>
    apiRequest<CollectionArchive>(`/api/v1/admin/finance/collections${qs(filters)}`, {
      accessToken: token,
    }),

  // ── Notifications ─────────────────────────────────────────────────────────

  unreadNotificationCount: (token: string) =>
    apiRequest<{ unread: number }>('/api/v1/admin/notifications/unread-count', {
      accessToken: token,
    }),

  notifications: (token: string, limit = 30) =>
    apiRequest<AdminNotification[]>(`/api/v1/admin/notifications?limit=${limit}`, {
      accessToken: token,
    }),

  markNotificationsRead: (token: string, ids?: string[]) =>
    apiRequest<{ marked: number }>('/api/v1/admin/notifications/read', {
      method: 'POST',
      accessToken: token,
      body: ids ? { notification_ids: ids } : {},
    }),

  // ── Support ───────────────────────────────────────────────────────────────

  supportThreads: (token: string, filters: Record<string, string | undefined> = {}) =>
    apiRequest<SupportThreadSummary[]>(`/api/v1/admin/support/threads${qs(filters)}`, {
      accessToken: token,
    }),

  supportThread: (token: string, threadId: string) =>
    apiRequest<SupportThreadDetail>(`/api/v1/admin/support/threads/${threadId}`, {
      accessToken: token,
    }),

  replyToSupportThread: (
    token: string,
    threadId: string,
    body: { message: string; resolve: boolean },
  ) =>
    apiRequest<{ sent: boolean }>(`/api/v1/admin/support/threads/${threadId}/messages`, {
      method: 'POST',
      accessToken: token,
      body,
    }),

  resolveSupportThread: (token: string, threadId: string, reason?: string) =>
    apiRequest<{ resolved: boolean }>(`/api/v1/admin/support/threads/${threadId}/resolve`, {
      method: 'POST',
      accessToken: token,
      body: reason ? { reason } : {},
    }),

  // ── Reviews ───────────────────────────────────────────────────────────────

  reviews: (token: string, filters: Record<string, string | undefined> = {}) =>
    apiRequest<AdminReview[]>(`/api/v1/admin/reviews${qs(filters)}`, { accessToken: token }),

  setReviewHidden: (token: string, reviewId: string, hidden: boolean, reason: string) =>
    apiRequest<{
      hidden: boolean;
      restaurant_rating: number | null;
      restaurant_rating_count: number;
      note_ar: string;
    }>(`/api/v1/admin/reviews/${reviewId}/visibility`, {
      method: 'POST',
      accessToken: token,
      body: { hidden, reason },
    }),

  restaurantsByArea: (token: string) =>
    apiRequest<AreaCoverage[]>('/api/v1/admin/restaurants/by-area', { accessToken: token }),

  unmaskPhone: (token: string, id: string, reason: string) =>
    apiRequest<{ phone: string }>(`/api/v1/admin/users/${id}/unmask-phone`, {
      method: 'POST',
      accessToken: token,
      body: { reason },
    }),

  blockCustomer: (token: string, id: string, blocked: boolean, reason: string) =>
    apiRequest<{ blocked: boolean }>(`/api/v1/admin/users/${id}/block`, {
      method: 'POST',
      accessToken: token,
      body: { blocked, reason },
    }),

  drivers: (token: string, filters: Record<string, string | undefined> = {}) =>
    apiRequest<AdminDriver[]>(`/api/v1/admin/drivers${qs(filters)}`, { accessToken: token }),

  suspendDriver: (token: string, id: string, suspended: boolean, reason: string) =>
    apiRequest<{ suspended: boolean }>(`/api/v1/admin/drivers/${id}/suspend`, {
      method: 'POST',
      accessToken: token,
      body: { suspended, reason },
    }),

  // ── Finance ─────────────────────────────────────────────────────────────
  settlements: (token: string, filters: Record<string, string | undefined> = {}) =>
    apiRequest<AdminSettlement[]>(`/api/v1/admin/finance/settlements${qs(filters)}`, {
      accessToken: token,
    }),

  settlement: (token: string, id: string) =>
    apiRequest<AdminSettlementDetail>(`/api/v1/admin/finance/settlements/${id}`, {
      accessToken: token,
    }),

  issueSettlement: (token: string, id: string) =>
    apiRequest<{ issued: boolean }>(`/api/v1/admin/finance/settlements/${id}/issue`, {
      method: 'POST',
      accessToken: token,
    }),

  recordPayment: (
    token: string,
    id: string,
    body: { amount_iqd: number; method: string; reference?: string; note?: string },
  ) =>
    apiRequest<{ payment_id: string; status: string; remaining_iqd: number }>(
      `/api/v1/admin/finance/settlements/${id}/record-payment`,
      { method: 'POST', accessToken: token, body },
    ),

  createAdjustment: (token: string, id: string, body: { amount_iqd: number; reason: string }) =>
    apiRequest<{ created: boolean }>(`/api/v1/admin/finance/settlements/${id}/adjustments`, {
      method: 'POST',
      accessToken: token,
      body,
    }),

  voidSettlement: (token: string, id: string, reason: string) =>
    apiRequest<{ voided: boolean; note_ar: string }>(
      `/api/v1/admin/finance/settlements/${id}/void`,
      { method: 'POST', accessToken: token, body: { reason } },
    ),

  financeSummary: (token: string, days = 30) =>
    apiRequest<FinanceSummary>(`/api/v1/admin/finance/summary?days=${days}`, {
      accessToken: token,
    }),

  // ── Settings ────────────────────────────────────────────────────────────
  config: (token: string) =>
    apiRequest<ConfigEntry[]>('/api/v1/admin/config', { accessToken: token }),

  updateConfig: (token: string, key: string, value: unknown, reason?: string) =>
    apiRequest<{ updated: boolean }>('/api/v1/admin/config', {
      method: 'PATCH',
      accessToken: token,
      body: { key, value, reason },
    }),

  staff: (token: string) =>
    apiRequest<StaffMember[]>('/api/v1/admin/staff', { accessToken: token }),

  roleMatrix: (token: string) =>
    apiRequest<RoleMatrix>('/api/v1/admin/roles', { accessToken: token }),

  setRole: (
    token: string,
    body: { user_id: string; role: string; granted: boolean; reason: string },
  ) =>
    apiRequest<{ updated: boolean }>('/api/v1/admin/staff/roles', {
      method: 'POST',
      accessToken: token,
      body,
    }),

  // ── MFA (plan §88) ──────────────────────────────────────────────────────
  mfaStatus: (token: string) =>
    apiRequest<MfaStatus>('/api/v1/auth/mfa/status', { accessToken: token }),

  mfaEnroll: (token: string) =>
    apiRequest<{ secret: string; otpauth_uri: string; expires_in_seconds: number }>(
      '/api/v1/auth/mfa/enroll',
      { method: 'POST', accessToken: token },
    ),

  mfaConfirm: (token: string, code: string) =>
    apiRequest<{ enabled: boolean; recovery_codes: string[]; warning_ar: string }>(
      '/api/v1/auth/mfa/confirm',
      { method: 'POST', accessToken: token, body: { code } },
    ),

  mfaVerify: (token: string, code: string) =>
    apiRequest<{ verified: boolean }>('/api/v1/auth/mfa/verify', {
      method: 'POST',
      accessToken: token,
      body: { code },
    }),
};
