import { apiRequest } from './api';

/**
 * What a courier's screen calls.
 *
 * Every one of these already existed for the mobile driver mode — the list,
 * the detail with its navigation links, the four transitions, the confirmation
 * with its PIN. Nothing here is a new capability; it is the same API reached
 * from a browser, because a courier with a username and a password needs a
 * page more than they need an install.
 */

export interface DriverMe {
  driver_id: string;
  status: string;
  availability: string;
  vehicle_type: string;
  active_assignment_id: string | null;
  active_assignment_status: string | null;
}

export interface DriverDelivery {
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

/**
 * Links out to whatever maps app the phone already has (plan §50).
 *
 * camelCase, unusually for a response body: this is a `@jibli/domain` object
 * the route hands through untouched rather than a payload assembled in
 * snake_case beside it. Declared here rather than imported from that package —
 * `@jibli/domain` reaches for the database, and a browser bundle has no
 * business pulling it in for four field names.
 */
export interface NavigationLinks {
  googleMaps: string | null;
  waze: string | null;
  /** Text to copy when neither app opens — a landmark address, usually. */
  copyableAddress: string | null;
  hasCoordinates: boolean;
}

export interface DriverDeliveryDetail {
  assignment_id: string;
  order_id: string;
  public_order_number: string;
  status: string;
  cash_to_collect_iqd: number;
  customer: { name: string; phone: string | null };
  customer_notes: string | null;
  delivery_address: Record<string, unknown>;
  navigation: NavigationLinks;
  restaurant_navigation: NavigationLinks;
}

const auth = (accessToken: string) => ({ accessToken });

export const driverApi = {
  me: (token: string) => apiRequest<DriverMe>('/api/v1/driver/me', auth(token)),

  availability: (token: string, availability: 'AVAILABLE' | 'OFFLINE') =>
    apiRequest<{ availability: string }>('/api/v1/driver/me/availability', {
      ...auth(token),
      method: 'PATCH',
      body: { availability },
    }),

  deliveries: (token: string, status: 'active' | 'history' = 'active') =>
    apiRequest<DriverDelivery[]>(`/api/v1/driver/deliveries?status=${status}`, auth(token)),

  delivery: (token: string, assignmentId: string) =>
    apiRequest<DriverDeliveryDetail>(
      `/api/v1/driver/deliveries/${assignmentId}`,
      auth(token),
    ),

  /** accept · reject · pickup · arrived-customer, which share one path. */
  transition: (
    token: string,
    assignmentId: string,
    action: 'accept' | 'reject' | 'pickup' | 'arrived-customer',
    body?: Record<string, unknown>,
  ) =>
    apiRequest<{ status: string }>(`/api/v1/driver/deliveries/${assignmentId}/${action}`, {
      ...auth(token),
      method: 'POST',
      ...(body ? { body } : {}),
    }),

  confirmDelivery: (token: string, assignmentId: string, deliveryPin?: string) =>
    apiRequest<{ order_id: string; status: string; cash_collected_iqd: number }>(
      `/api/v1/driver/deliveries/${assignmentId}/confirm-delivery`,
      {
        ...auth(token),
        method: 'POST',
        body: deliveryPin ? { delivery_pin: deliveryPin } : {},
      },
    ),
};
