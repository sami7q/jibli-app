import type { DeliveryAssignmentStatus, OrderStatus } from './enums.js';

/**
 * Domain events written to the transactional outbox (plan §31).
 *
 * An event row is inserted in the same transaction as the state change it
 * describes, so "the order exists but nobody was told" cannot happen. The worker
 * then publishes to realtime and push.
 *
 * Payloads carry IDs and the minimum a consumer needs to render an alert. They
 * deliberately do NOT carry full addresses or phone numbers: push bodies can
 * appear on a locked screen (plan §107).
 */

export const EVENT_TYPES = {
  ORDER_PLACED: 'order.placed',
  ORDER_ACCEPTED: 'order.accepted',
  ORDER_REJECTED: 'order.rejected',
  ORDER_PREPARING: 'order.preparing',
  ORDER_READY: 'order.ready',
  ORDER_OUT_FOR_DELIVERY: 'order.out_for_delivery',
  ORDER_DELIVERED: 'order.delivered',
  ORDER_COMPLETED: 'order.completed',
  ORDER_CANCELLED: 'order.cancelled',

  DELIVERY_ASSIGNED: 'delivery.assigned',
  DELIVERY_ACCEPTED: 'delivery.accepted',
  DELIVERY_REJECTED: 'delivery.rejected',
  DELIVERY_PICKED_UP: 'delivery.picked_up',
  DELIVERY_ARRIVED: 'delivery.arrived',
  DELIVERY_REASSIGNED: 'delivery.reassigned',

  INVENTORY_LOW_STOCK: 'inventory.low_stock',

  SETTLEMENT_ISSUED: 'settlement.issued',
  SETTLEMENT_PAYMENT_RECORDED: 'settlement.payment_recorded',
  SETTLEMENT_OVERDUE: 'settlement.overdue',

  RESTAURANT_APPROVED: 'restaurant.approved',
  RESTAURANT_REJECTED: 'restaurant.rejected',
  RESTAURANT_INFO_REQUESTED: 'restaurant.info_requested',
  RESTAURANT_SUSPENDED: 'restaurant.suspended',
  /** The restaurant says it is ready to trade; Admin decides (plan §122). */
  RESTAURANT_ACTIVATION_REQUESTED: 'restaurant.activation_requested',

  GEOGRAPHY_CAPABILITY_CHANGED: 'geography.capability_changed',

  DRIVER_INVITED: 'driver.invited',
  DRIVER_SUSPENDED: 'driver.suspended',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

/** Envelope every outbox row shares. */
export interface DomainEvent<TType extends EventType, TPayload> {
  /** Stable event ID; consumers use it to deduplicate on reconnect (plan §31). */
  readonly id: string;
  readonly type: TType;
  readonly occurredAt: string;
  /** Correlates the event with the HTTP request that caused it (plan §89). */
  readonly requestId: string | null;
  /** Aggregate the event belongs to, used for ordered per-entity delivery. */
  readonly aggregateType: 'order' | 'delivery' | 'restaurant' | 'settlement' | 'inventory' | 'geography' | 'driver';
  readonly aggregateId: string;
  /** Aggregate version at the time of the event; lets a client drop stale events. */
  readonly aggregateVersion: number;
  readonly payload: TPayload;
}

export interface OrderEventPayload {
  readonly orderId: string;
  readonly publicOrderNumber: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly customerId: string;
  readonly status: OrderStatus;
  readonly customerTotalIqd: number;
  readonly itemCount: number;
  /** First name only — enough to render the alert, no more (plan §84). */
  readonly customerFirstName: string;
  readonly reason?: string | null;
}

export interface DeliveryEventPayload {
  readonly assignmentId: string;
  readonly orderId: string;
  readonly publicOrderNumber: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly driverId: string;
  readonly status: DeliveryAssignmentStatus;
  readonly reason?: string | null;
}

export interface LowStockEventPayload {
  readonly inventoryItemId: string;
  readonly restaurantId: string;
  readonly branchId: string;
  readonly nameAr: string;
  readonly onHand: string;
  readonly threshold: string;
  readonly unit: string;
}

export interface SettlementEventPayload {
  readonly settlementId: string;
  readonly restaurantId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly amountDueIqd: number;
  readonly amountPaidIqd: number;
  readonly dueDate: string | null;
}

export interface RestaurantEventPayload {
  readonly restaurantId: string;
  readonly displayName: string;
  readonly ownerUserId: string | null;
  readonly reason?: string | null;
}

export interface GeographyEventPayload {
  readonly entityType: 'governorate' | 'city';
  readonly entityId: string;
  readonly code: string;
  readonly nameAr: string;
  readonly changes: Record<string, { readonly from: boolean; readonly to: boolean }>;
  readonly reason: string | null;
}

export interface DriverEventPayload {
  readonly driverId: string;
  readonly userId: string;
  readonly restaurantId: string;
  readonly branchId: string | null;
  readonly reason?: string | null;
}

/** Discriminated union of everything the outbox can carry. */
export type JibliEvent =
  | DomainEvent<
      | typeof EVENT_TYPES.ORDER_PLACED
      | typeof EVENT_TYPES.ORDER_ACCEPTED
      | typeof EVENT_TYPES.ORDER_REJECTED
      | typeof EVENT_TYPES.ORDER_PREPARING
      | typeof EVENT_TYPES.ORDER_READY
      | typeof EVENT_TYPES.ORDER_OUT_FOR_DELIVERY
      | typeof EVENT_TYPES.ORDER_DELIVERED
      | typeof EVENT_TYPES.ORDER_COMPLETED
      | typeof EVENT_TYPES.ORDER_CANCELLED,
      OrderEventPayload
    >
  | DomainEvent<
      | typeof EVENT_TYPES.DELIVERY_ASSIGNED
      | typeof EVENT_TYPES.DELIVERY_ACCEPTED
      | typeof EVENT_TYPES.DELIVERY_REJECTED
      | typeof EVENT_TYPES.DELIVERY_PICKED_UP
      | typeof EVENT_TYPES.DELIVERY_ARRIVED
      | typeof EVENT_TYPES.DELIVERY_REASSIGNED,
      DeliveryEventPayload
    >
  | DomainEvent<typeof EVENT_TYPES.INVENTORY_LOW_STOCK, LowStockEventPayload>
  | DomainEvent<
      | typeof EVENT_TYPES.SETTLEMENT_ISSUED
      | typeof EVENT_TYPES.SETTLEMENT_PAYMENT_RECORDED
      | typeof EVENT_TYPES.SETTLEMENT_OVERDUE,
      SettlementEventPayload
    >
  | DomainEvent<
      | typeof EVENT_TYPES.RESTAURANT_APPROVED
      | typeof EVENT_TYPES.RESTAURANT_REJECTED
      | typeof EVENT_TYPES.RESTAURANT_INFO_REQUESTED
      | typeof EVENT_TYPES.RESTAURANT_SUSPENDED,
      RestaurantEventPayload
    >
  | DomainEvent<typeof EVENT_TYPES.GEOGRAPHY_CAPABILITY_CHANGED, GeographyEventPayload>
  | DomainEvent<
      typeof EVENT_TYPES.DRIVER_INVITED | typeof EVENT_TYPES.DRIVER_SUSPENDED,
      DriverEventPayload
    >;

/**
 * Realtime channel names. Authorization is checked when a socket subscribes —
 * a channel name is not a capability (plan §63).
 */
export const channels = {
  restaurantOrders: (restaurantId: string) => `restaurant:${restaurantId}:orders`,
  branchOrders: (branchId: string) => `branch:${branchId}:orders`,
  customerOrder: (orderId: string) => `order:${orderId}`,
  customerOrders: (userId: string) => `customer:${userId}:orders`,
  driverTasks: (driverId: string) => `driver:${driverId}:tasks`,
  adminOperations: () => `admin:operations`,
} as const;

/** Which events reach which audience — used by the outbox publisher. */
export const EVENT_AUDIENCE: Record<EventType, readonly ('customer' | 'restaurant' | 'driver' | 'admin')[]> = {
  'order.placed': ['restaurant', 'admin'],
  'order.accepted': ['customer', 'restaurant'],
  'order.rejected': ['customer', 'restaurant', 'admin'],
  'order.preparing': ['customer', 'restaurant'],
  'order.ready': ['customer', 'restaurant', 'driver'],
  'order.out_for_delivery': ['customer', 'restaurant'],
  'order.delivered': ['customer', 'restaurant'],
  'order.completed': ['customer', 'restaurant', 'admin'],
  'order.cancelled': ['customer', 'restaurant', 'admin'],
  'delivery.assigned': ['driver', 'restaurant'],
  'delivery.accepted': ['restaurant'],
  'delivery.rejected': ['restaurant'],
  'delivery.picked_up': ['customer', 'restaurant'],
  'delivery.arrived': ['customer', 'restaurant'],
  'delivery.reassigned': ['driver', 'restaurant'],
  'inventory.low_stock': ['restaurant'],
  'settlement.issued': ['restaurant', 'admin'],
  'settlement.payment_recorded': ['restaurant', 'admin'],
  'settlement.overdue': ['restaurant', 'admin'],
  'restaurant.approved': ['restaurant', 'admin'],
  'restaurant.rejected': ['restaurant', 'admin'],
  'restaurant.info_requested': ['restaurant'],
  'restaurant.suspended': ['restaurant', 'admin'],
  // Admin decides; the restaurant already knows it asked.
  'restaurant.activation_requested': ['admin'],
  'geography.capability_changed': ['admin'],
  'driver.invited': ['driver'],
  'driver.suspended': ['driver', 'restaurant'],
};
