import { apiRequest, apiRequestWithMeta } from './api';

/**
 * Restaurant Portal endpoint bindings.
 *
 * Every call carries the restaurant scope header. The server treats it as a
 * selector among restaurants the session already proves membership of — it
 * grants nothing on its own (plan §63).
 */

export interface MenuItem {
  id: string;
  name_ar: string;
  description_ar: string | null;
  base_price_iqd: number;
  cost_price_iqd?: number;
  margin_iqd?: number;
  sku: string | null;
  /** The dish photo. Null until somebody uploads one. */
  image_asset_id: string | null;
  is_active: boolean;
  is_available: boolean;
  unavailable_by_inventory: boolean;
  is_popular: boolean;
  preparation_minutes_override: number | null;
  sort_order: number;
}

export interface MenuCategory {
  id: string;
  name_ar: string;
  description_ar: string | null;
  sort_order: number;
  is_active: boolean;
  items: MenuItem[];
}

export interface MenuResponse {
  menu_version: number;
  can_see_cost: boolean;
  categories: MenuCategory[];
}

export interface ModifierGroup {
  id: string;
  name_ar: string;
  min_select: number;
  max_select: number;
  is_required: boolean;
  is_active: boolean;
  modifiers: { id: string; name_ar: string; price_iqd: number; is_available: boolean }[];
}

export interface InventoryItem {
  id: string;
  name_ar: string;
  sku: string | null;
  unit: string;
  on_hand: string;
  reserved: string;
  available: string;
  low_stock_threshold: string | null;
  is_low_stock: boolean;
  is_tracked: boolean;
  allow_negative_stock: boolean;
  unit_cost_iqd?: number | null;
  stock_value_iqd?: number;
}

export interface InventoryMovement {
  id: string;
  type: string;
  quantity_delta: string;
  resulting_on_hand: string;
  reason: string | null;
  order_id: string | null;
  actor_name: string;
  created_at: string;
}

export interface ProfitSummary {
  order_count: number;
  net_sales_iqd: number;
  delivery_fees_iqd: number;
  cost_of_goods_iqd: number;
  gross_profit_iqd: number;
  commission_iqd: number;
  operating_expenses_iqd: number;
  estimated_operating_profit_iqd: number;
  cost_data_coverage_percent: number;
  is_estimate: boolean;
  note_ar: string;
}

export interface Expense {
  id: string;
  category: string;
  amount_iqd: number;
  description_ar: string | null;
  expense_date: string;
  created_by: string | null;
  created_at: string;
}

export interface PortalSettlement {
  id: string;
  period_start: string;
  period_end: string;
  policy: string;
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

export interface PortalSettlementDetail extends PortalSettlement {
  /** Set only once the restaurant has objected; drives the banner (plan §44). */
  dispute_reason: string | null;
  lines: {
    public_order_number: string;
    commission_base_iqd: number;
    commission_display: string;
    commission_amount_iqd: number;
    completed_at: string;
  }[];
  payments: {
    amount_iqd: number;
    method: string;
    reference: string | null;
    paid_at: string;
  }[];
}

export interface DriverCashRow {
  driver_id: string;
  driver_name: string | null;
  collected_iqd: number;
  handed_over_iqd: number;
  adjustments_iqd: number;
  current_custody_iqd: number;
}

export interface PortalDriver {
  id: string;
  full_name: string | null;
  phone: string;
  status: string;
  availability: string;
  vehicle_type: string;
  plate_number: string | null;
  can_collect_cash: boolean;
  is_active: boolean;
  internal_note: string | null;
  activated: boolean;
  active_assignments: number;
  cash_custody_iqd: number;
  last_seen_at: string | null;
}

export interface StaffMember {
  id: string;
  user_id: string;
  full_name: string | null;
  phone: string;
  role: string;
  is_active: boolean;
  created_at: string;
}

export interface WorkingHour {
  id: string;
  day_of_week: number;
  day_name_ar: string;
  opens_at: string;
  closes_at: string;
  opens_at_minute: number;
  closes_at_minute: number;
  is_closed: boolean;
  is_overnight: boolean;
}

export interface PortalReadiness {
  ready: boolean;
  checks: { key: string; label_ar: string; passed: boolean; blocking: boolean }[];
  blocking_failures: string[];
  operational_status: string;
  activation_requested_at: string | null;
  activation_request_note: string | null;
}

export interface PortalSettings {
  restaurant: {
    /** Ready to render; the portal shows it, it does not resolve it. */
    logo_url: string | null;
    id: string;
    display_name: string;
    description_ar: string | null;
    partner_code: string;
    merchant_type: 'RESTAURANT' | 'MARKET' | 'COSMETICS';
    operational_status: string;
    cuisine_tags: string[];
    minimum_order_iqd: number;
  };
  branch: {
    id: string;
    name: string;
    address_text: string;
    district_text: string | null;
    city_name_ar: string;
    governorate_name_ar: string;
    phone: string | null;
    latitude: number | null;
    longitude: number | null;
    is_active: boolean;
    accepts_orders: boolean;
    delivery_fee_iqd: number;
    base_preparation_minutes: number;
    service_radius_meters: number | null;
  };
  busy_mode: string;
  busy_mode_expires_at: string | null;
  is_open: boolean;
  accepts_orders_now: boolean;
  estimated_preparation_minutes: number;
  closed_reason: string;
  city_ordering_enabled: boolean;
  working_hours: WorkingHour[];
  hour_exceptions: {
    id: string;
    local_date: string;
    is_closed: boolean;
    opens_at: string | null;
    closes_at: string | null;
    note_ar: string | null;
  }[];
}

export interface HistoryOrder {
  id: string;
  public_order_number: string;
  status: string;
  placed_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  customer_name: string;
  customer_phone_masked: string;
  items_subtotal_iqd: number;
  delivery_fee_iqd: number;
  discount_total_iqd: number;
  customer_total_iqd: number;
  commission_amount_iqd: number;
  restaurant_net_iqd: number;
  closing_reason: string | null;
  driver_name: string | null;
}

export interface OpenCommissions {
  order_count: number;
  commission_total_iqd: number;
  /** Absent on an API deployed before the service fee was collected. */
  service_fee_total_iqd?: number;
  platform_due_iqd?: number;
  commission_base_total_iqd: number;
  gross_sales_iqd: number;
  restaurant_net_iqd: number;
  first_completed_at: string | null;
  last_completed_at: string | null;
  last_settled_period_end: string | null;
  policy: string | null;
  truncated: boolean;
  orders: {
    id: string;
    public_order_number: string;
    completed_at: string | null;
    commission_base_iqd: number;
    commission_flat_iqd: number;
    commission_display: string;
    commission_amount_iqd: number;
    service_fee_iqd?: number;
    customer_total_iqd: number;
    delivery_fee_iqd: number;
    restaurant_net_iqd: number;
  }[];
  note_ar: string;
}

export interface DashboardOverview {
  orders_today: number;
  orders_today_delta: number | null;
  sales_today_iqd: number;
  sales_today_delta: number | null;
  average_order_iqd: number;
  average_order_delta: number | null;
  new_orders: number;
  new_orders_delta: number | null;
  active_menu_items: number;
  weekly_series: { date: string; label_ar: string; sales_iqd: number; order_count: number }[];
  weekly_total_iqd: number;
  best_sellers: {
    menu_item_id: string | null;
    name_ar: string;
    units_sold: number;
    revenue_iqd: number;
  }[];
  low_stock: {
    id: string;
    name_ar: string;
    on_hand: string;
    /** On hand minus reserved — the figure the threshold is compared against. */
    available: string;
    threshold: string | null;
    unit: string;
  }[];
  /** Null when the role may not see money at all (plan §86). */
  finance: {
    open_commission_iqd: number;
    open_order_count: number;
    estimated_net_iqd: number | null;
    commission_flat_iqd: number | null;
    period_label_ar: string;
    period_end: string;
    days_until_settlement: number;
  } | null;
}

interface Auth {
  readonly accessToken: string;
  readonly restaurantId: string;
}

const scoped = (auth: Auth) => ({
  accessToken: auth.accessToken,
  restaurantId: auth.restaurantId,
});

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

export interface SupportThreadSummary {
  id: string;
  subject: string;
  topic: string;
  status: 'OPEN' | 'ANSWERED' | 'RESOLVED';
  priority: 'NORMAL' | 'URGENT';
  last_message_at: string;
  last_message_from: 'RESTAURANT' | 'JIBLI';
  awaiting_you: boolean;
  message_count: number;
  created_at: string;
}

export interface SupportThreadDetail {
  id: string;
  subject: string;
  topic: string;
  status: 'OPEN' | 'ANSWERED' | 'RESOLVED';
  priority: 'NORMAL' | 'URGENT';
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

export interface PortalReviews {
  rating: number | null;
  rating_count: number;
  distribution: Record<string, number>;
  reviews: {
    id: string;
    rating: number;
    comment: string | null;
    public_order_number: string;
    author_name: string;
    created_at: string;
  }[];
}

export const portal = {
  // ── Support ─────────────────────────────────────────────────────────────

  supportThreads: (auth: Auth) =>
    apiRequest<SupportThreadSummary[]>('/api/v1/restaurant-portal/support/threads', scoped(auth)),

  supportThread: (auth: Auth, threadId: string) =>
    apiRequest<SupportThreadDetail>(
      `/api/v1/restaurant-portal/support/threads/${threadId}`,
      scoped(auth),
    ),

  openSupportThread: (
    auth: Auth,
    body: { subject: string; topic: string; priority: string; message: string },
  ) =>
    apiRequest<{ id: string; note_ar: string }>('/api/v1/restaurant-portal/support/threads', {
      ...scoped(auth),
      method: 'POST',
      body,
    }),

  replyToSupportThread: (auth: Auth, threadId: string, message: string) =>
    apiRequest<{ sent: boolean }>(
      `/api/v1/restaurant-portal/support/threads/${threadId}/messages`,
      { ...scoped(auth), method: 'POST', body: { message } },
    ),

  // ── Reviews ─────────────────────────────────────────────────────────────

  reviews: (auth: Auth, filters: Record<string, string | number | undefined> = {}) =>
    apiRequest<PortalReviews>(`/api/v1/restaurant-portal/reviews${qs(filters)}`, scoped(auth)),

  /** Report a review to Jibli's moderators. */
  reportReview: (
    auth: Auth,
    reviewId: string,
    body: { reason: 'ABUSIVE' | 'SPAM' | 'PERSONAL_DATA' | 'FALSE' | 'OTHER'; note?: string },
  ) =>
    apiRequest<{ reported: boolean; hidden: boolean; note_ar: string }>(
      `/api/v1/reviews/${reviewId}/report`,
      { ...scoped(auth), method: 'POST', body },
    ),

  /** Stop seeing this review's author in this account's list. */
  blockReviewAuthor: (auth: Auth, reviewId: string) =>
    apiRequest<{ blocked: boolean; note_ar: string }>(`/api/v1/reviews/${reviewId}/block-author`, {
      ...scoped(auth),
      method: 'POST',
      body: {},
    }),

  // ── Dashboard ───────────────────────────────────────────────────────────
  /** Everything the home screen shows, in one round trip (plan §131). */
  dashboard: (auth: Auth) =>
    apiRequest<DashboardOverview>('/api/v1/restaurant-portal/dashboard/overview', scoped(auth)),

  // ── Orders history & running commission ─────────────────────────────────
  /**
   * One page of finished orders plus the cursor for the next.
   *
   * Keyset, not offset: new orders arrive while the user pages, and an offset
   * would skip or repeat rows as the list shifts underneath them.
   */
  orderHistory: async (auth: Auth, filters: Record<string, string | number | undefined> = {}) => {
    const envelope = await apiRequestWithMeta<HistoryOrder[]>(
      `/api/v1/restaurant-portal/orders/history${qs(filters)}`,
      scoped(auth),
    );
    return {
      rows: envelope.data,
      hasMore: Boolean(envelope.meta.has_more),
      nextBefore: (envelope.meta.next_before as string | null) ?? null,
    };
  },

  openCommissions: (auth: Auth) =>
    apiRequest<OpenCommissions>('/api/v1/restaurant-portal/finance/commissions/open', scoped(auth)),

  // ── Menu ────────────────────────────────────────────────────────────────
  menu: (auth: Auth) => apiRequest<MenuResponse>('/api/v1/restaurant-portal/menu', scoped(auth)),

  createCategory: (auth: Auth, body: unknown) =>
    apiRequest<{ id: string }>('/api/v1/restaurant-portal/menu/categories', {
      ...scoped(auth),
      method: 'POST',
      body,
    }),

  updateCategory: (auth: Auth, id: string, body: unknown) =>
    apiRequest<{ updated: boolean }>(`/api/v1/restaurant-portal/menu/categories/${id}`, {
      ...scoped(auth),
      method: 'PATCH',
      body,
    }),

  deleteCategory: (auth: Auth, id: string) =>
    apiRequest<{ deleted: boolean }>(`/api/v1/restaurant-portal/menu/categories/${id}`, {
      ...scoped(auth),
      method: 'DELETE',
    }),

  createItem: (auth: Auth, body: unknown) =>
    apiRequest<{ id: string }>('/api/v1/restaurant-portal/menu/items', {
      ...scoped(auth),
      method: 'POST',
      body,
    }),

  updateItem: (auth: Auth, id: string, body: unknown) =>
    apiRequest<{ updated: boolean }>(`/api/v1/restaurant-portal/menu/items/${id}`, {
      ...scoped(auth),
      method: 'PATCH',
      body,
    }),

  setItemAvailability: (auth: Auth, id: string, isAvailable: boolean) =>
    apiRequest<{ is_available: boolean }>(
      `/api/v1/restaurant-portal/menu/items/${id}/availability`,
      { ...scoped(auth), method: 'POST', body: { is_available: isAvailable } },
    ),

  deleteItem: (auth: Auth, id: string) =>
    apiRequest<{ deleted: boolean }>(`/api/v1/restaurant-portal/menu/items/${id}`, {
      ...scoped(auth),
      method: 'DELETE',
    }),

  modifierGroups: (auth: Auth) =>
    apiRequest<ModifierGroup[]>('/api/v1/restaurant-portal/menu/modifier-groups', scoped(auth)),

  createModifierGroup: (auth: Auth, body: unknown) =>
    apiRequest<{ id: string }>('/api/v1/restaurant-portal/menu/modifier-groups', {
      ...scoped(auth),
      method: 'POST',
      body,
    }),

  // ── Inventory ───────────────────────────────────────────────────────────
  inventory: (auth: Auth) =>
    apiRequest<InventoryItem[]>('/api/v1/restaurant-portal/inventory', scoped(auth)),

  createInventoryItem: (auth: Auth, body: unknown) =>
    apiRequest<{ id: string }>('/api/v1/restaurant-portal/inventory', {
      ...scoped(auth),
      method: 'POST',
      body,
    }),

  stockCommand: (
    auth: Auth,
    id: string,
    command: 'receive' | 'adjust' | 'waste' | 'return',
    body: { quantity: string; unit_cost_iqd?: number; reason?: string },
  ) =>
    apiRequest<{ on_hand: string }>(`/api/v1/restaurant-portal/inventory/${id}/${command}`, {
      ...scoped(auth),
      method: 'POST',
      body,
    }),

  movements: (auth: Auth, id: string) =>
    apiRequest<InventoryMovement[]>(
      `/api/v1/restaurant-portal/inventory/${id}/movements`,
      scoped(auth),
    ),

  // ── Finance ─────────────────────────────────────────────────────────────
  profit: (auth: Auth, days = 30) =>
    apiRequest<ProfitSummary>(
      `/api/v1/restaurant-portal/finance/profit?days=${days}`,
      scoped(auth),
    ),

  /**
   * Returns the page of rows *and* the server's total across every matching
   * row. Summing the page would understate the total once the list is capped.
   */
  expenses: async (auth: Auth, filters: Record<string, string | undefined> = {}) => {
    const envelope = await apiRequestWithMeta<Expense[]>(
      `/api/v1/restaurant-portal/finance/expenses${qs(filters)}`,
      scoped(auth),
    );
    return {
      rows: envelope.data,
      totalIqd: Number(envelope.meta.total_iqd ?? 0),
    };
  },

  createExpense: (auth: Auth, body: unknown) =>
    apiRequest<{ id: string }>('/api/v1/restaurant-portal/finance/expenses', {
      ...scoped(auth),
      method: 'POST',
      body,
    }),

  settlements: (auth: Auth, filters: Record<string, string | undefined> = {}) =>
    apiRequest<PortalSettlement[]>(
      `/api/v1/restaurant-portal/finance/settlements${qs(filters)}`,
      scoped(auth),
    ),

  settlement: (auth: Auth, id: string) =>
    apiRequest<PortalSettlementDetail>(
      `/api/v1/restaurant-portal/finance/settlements/${id}`,
      scoped(auth),
    ),

  disputeSettlement: (auth: Auth, id: string, reason: string) =>
    apiRequest<{ disputed: boolean; note_ar: string }>(
      `/api/v1/restaurant-portal/finance/settlements/${id}/dispute`,
      { ...scoped(auth), method: 'POST', body: { reason } },
    ),

  driverCash: (auth: Auth) =>
    apiRequest<DriverCashRow[]>('/api/v1/restaurant-portal/finance/driver-cash', scoped(auth)),

  /**
   * Money-moving, so the key is required rather than optional: a retry after a
   * timeout must replay the original receipt instead of recording a second
   * handover (plan §28).
   */
  recordHandover: (
    auth: Auth,
    body: { driver_id: string; amount_iqd: number; reference?: string; note?: string },
    idempotencyKey: string,
  ) =>
    apiRequest<{ handover_id: string; note_ar: string }>(
      '/api/v1/restaurant-portal/finance/driver-cash/handover',
      { ...scoped(auth), method: 'POST', body, idempotencyKey },
    ),

  // ── Team ────────────────────────────────────────────────────────────────
  drivers: (auth: Auth) =>
    apiRequest<PortalDriver[]>('/api/v1/restaurant-portal/drivers', scoped(auth)),

  createDriver: (auth: Auth, body: unknown) =>
    apiRequest<{ driver_id: string; note_ar: string }>('/api/v1/restaurant-portal/drivers', {
      ...scoped(auth),
      method: 'POST',
      body,
    }),

  /**
   * Put a driver to work.
   *
   * The restaurant's own call, not Admin's: it recruited this person and is
   * the party asserting they have agreed to carry its orders. Until this
   * existed nothing anywhere set `activated_at`, so every driver stayed
   * `PENDING_ACTIVATION` and the assignment picker — which filters on ACTIVE —
   * was empty for every restaurant.
   */
  activateDriver: (auth: Auth, id: string) =>
    apiRequest<{ status: string }>(`/api/v1/restaurant-portal/drivers/${id}/activate`, {
      ...scoped(auth),
      method: 'POST',
    }),

  /**
   * Issue a driver their username and password.
   *
   * The password comes back exactly once and is stored only as a hash, so the
   * screen that calls this has to show it before it navigates anywhere.
   */
  issueDriverCredentials: (auth: Auth, id: string, username: string) =>
    apiRequest<{ username: string; password: string; note_ar: string }>(
      `/api/v1/restaurant-portal/drivers/${id}/credentials`,
      { ...scoped(auth), method: 'POST', body: { username } },
    ),

  updateDriver: (auth: Auth, id: string, body: unknown) =>
    apiRequest<{ updated: boolean }>(`/api/v1/restaurant-portal/drivers/${id}`, {
      ...scoped(auth),
      method: 'PATCH',
      body,
    }),

  staff: (auth: Auth) => apiRequest<StaffMember[]>('/api/v1/restaurant-portal/staff', scoped(auth)),

  createStaff: (auth: Auth, body: unknown) =>
    apiRequest<{ id: string; note_ar: string }>('/api/v1/restaurant-portal/staff', {
      ...scoped(auth),
      method: 'POST',
      body,
    }),

  updateStaff: (auth: Auth, id: string, body: unknown) =>
    apiRequest<{ updated: boolean }>(`/api/v1/restaurant-portal/staff/${id}`, {
      ...scoped(auth),
      method: 'PATCH',
      body,
    }),

  // ── Settings ────────────────────────────────────────────────────────────
  /** Posts a data URL and returns the stored asset. Same contract as Admin. */
  uploadImage: (
    auth: Auth,
    body: { data: string; purpose?: 'RESTAURANT_LOGO' | 'RESTAURANT_COVER' | 'MENU_ITEM' },
  ) =>
    apiRequest<{ asset_id: string; url: string }>('/api/v1/uploads', {
      ...scoped(auth),
      method: 'POST',
      body: { ...body, restaurant_id: auth.restaurantId },
    }),

  /** The same checklist Admin reads, for this restaurant. */
  readiness: (auth: Auth) =>
    apiRequest<PortalReadiness>('/api/v1/restaurant-portal/readiness', scoped(auth)),

  requestActivation: (auth: Auth, note?: string) =>
    apiRequest<{ requested_at: string; note_ar: string }>(
      '/api/v1/restaurant-portal/activation-request',
      { ...scoped(auth), method: 'POST', body: { ...(note ? { note } : {}) } },
    ),

  withdrawActivation: (auth: Auth) =>
    apiRequest<{ withdrawn: boolean }>('/api/v1/restaurant-portal/activation-request', {
      ...scoped(auth),
      method: 'DELETE',
    }),

  settings: (auth: Auth) =>
    apiRequest<PortalSettings>('/api/v1/restaurant-portal/settings', scoped(auth)),

  updateSettings: (auth: Auth, body: unknown) =>
    apiRequest<{ updated: boolean }>('/api/v1/restaurant-portal/settings', {
      ...scoped(auth),
      method: 'PATCH',
      body,
    }),

  setWorkingHours: (auth: Auth, hours: unknown[]) =>
    apiRequest<{ updated: boolean }>('/api/v1/restaurant-portal/settings/working-hours', {
      ...scoped(auth),
      method: 'PUT',
      body: { hours },
    }),

  setBusyMode: (auth: Auth, busyMode: string, expiresInMinutes?: number) =>
    apiRequest<{ busy_mode: string; expires_at: string | null; note_ar: string }>(
      '/api/v1/restaurant-portal/settings/busy-mode',
      {
        ...scoped(auth),
        method: 'POST',
        body: { busy_mode: busyMode, expires_in_minutes: expiresInMinutes },
      },
    ),

  addHourException: (auth: Auth, body: unknown) =>
    apiRequest<{ saved: boolean }>('/api/v1/restaurant-portal/settings/hour-exceptions', {
      ...scoped(auth),
      method: 'POST',
      body,
    }),
};
