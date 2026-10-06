import { ERROR_CODES, AppError } from './errors.js';
import type {
  ActorType,
  DeliveryAssignmentStatus,
  OrderStatus,
  SettlementStatus,
} from './enums.js';

/**
 * Controlled state machines (plan §4.3, §26, §49).
 *
 * "No endpoint accepts arbitrary raw status updates." Transitions are declared
 * once, here, together with who is allowed to trigger them. Route handlers call
 * named commands; the command consults this table.
 */

export interface TransitionRule<S extends string> {
  readonly from: S;
  readonly to: S;
  /** Actors permitted to perform this transition. ADMIN overrides are explicit. */
  readonly actors: readonly ActorType[];
  /** A human-readable command name used in audit logs and history rows. */
  readonly command: string;
  /** Whether a reason must accompany the transition. */
  readonly requiresReason?: boolean;
}

// ── Order ────────────────────────────────────────────────────────────────────

export const ORDER_TRANSITIONS: readonly TransitionRule<OrderStatus>[] = [
  // Placement is immediately visible to the restaurant queue.
  { from: 'PLACED', to: 'PENDING_RESTAURANT', actors: ['SYSTEM'], command: 'QueueForRestaurant' },

  {
    from: 'PENDING_RESTAURANT',
    to: 'ACCEPTED',
    actors: ['RESTAURANT', 'ADMIN'],
    command: 'AcceptOrder',
  },
  {
    from: 'PENDING_RESTAURANT',
    to: 'REJECTED',
    actors: ['RESTAURANT', 'ADMIN'],
    command: 'RejectOrder',
    requiresReason: true,
  },

  { from: 'ACCEPTED', to: 'PREPARING', actors: ['RESTAURANT', 'ADMIN'], command: 'MarkPreparing' },
  // A restaurant may go straight to READY for a pre-made item.
  { from: 'ACCEPTED', to: 'READY', actors: ['RESTAURANT', 'ADMIN'], command: 'MarkReady' },
  { from: 'PREPARING', to: 'READY', actors: ['RESTAURANT', 'ADMIN'], command: 'MarkReady' },

  // The order stays READY while a driver is merely assigned; pickup moves it on (plan §49).
  { from: 'READY', to: 'OUT_FOR_DELIVERY', actors: ['DRIVER', 'ADMIN'], command: 'PickupOrder' },

  {
    from: 'OUT_FOR_DELIVERY',
    to: 'DELIVERED',
    actors: ['DRIVER', 'ADMIN'],
    command: 'ConfirmDelivery',
  },
  // COD completion closes the order in the same transaction as delivery (plan §53).
  { from: 'DELIVERED', to: 'COMPLETED', actors: ['SYSTEM', 'ADMIN'], command: 'CompleteOrder' },

  // Cancellation paths. Customers may only cancel before the kitchen commits.
  {
    from: 'PLACED',
    to: 'CANCELLED',
    actors: ['CUSTOMER', 'ADMIN', 'SYSTEM'],
    command: 'CancelOrder',
    requiresReason: true,
  },
  {
    from: 'PENDING_RESTAURANT',
    to: 'CANCELLED',
    actors: ['CUSTOMER', 'ADMIN', 'SYSTEM'],
    command: 'CancelOrder',
    requiresReason: true,
  },
  {
    from: 'ACCEPTED',
    to: 'CANCELLED',
    actors: ['RESTAURANT', 'ADMIN'],
    command: 'CancelOrder',
    requiresReason: true,
  },
  {
    from: 'PREPARING',
    to: 'CANCELLED',
    actors: ['ADMIN'],
    command: 'CancelOrder',
    requiresReason: true,
  },
  {
    from: 'READY',
    to: 'CANCELLED',
    actors: ['ADMIN'],
    command: 'CancelOrder',
    requiresReason: true,
  },
  {
    from: 'OUT_FOR_DELIVERY',
    to: 'CANCELLED',
    actors: ['ADMIN'],
    command: 'CancelOrder',
    requiresReason: true,
  },
];

/** Statuses from which no further transition is possible. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  'COMPLETED',
  'REJECTED',
  'CANCELLED',
];

/** Statuses that keep an order on the restaurant's live board (plan §29). */
export const LIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  'PENDING_RESTAURANT',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
];

/** An order in one of these states has consumed stock and owes commission on completion. */
export const REVENUE_BEARING_ORDER_STATUSES: readonly OrderStatus[] = ['DELIVERED', 'COMPLETED'];

// ── Delivery assignment ──────────────────────────────────────────────────────

export const DELIVERY_TRANSITIONS: readonly TransitionRule<DeliveryAssignmentStatus>[] = [
  { from: 'ASSIGNED', to: 'ACCEPTED', actors: ['DRIVER'], command: 'AcceptAssignment' },
  {
    from: 'ASSIGNED',
    to: 'REJECTED',
    actors: ['DRIVER'],
    command: 'RejectAssignment',
    requiresReason: true,
  },
  // The restaurant can pull an assignment back from an unresponsive driver.
  {
    from: 'ASSIGNED',
    to: 'REASSIGNED',
    actors: ['RESTAURANT', 'ADMIN', 'SYSTEM'],
    command: 'ReassignDelivery',
    requiresReason: true,
  },
  {
    from: 'ACCEPTED',
    to: 'REASSIGNED',
    actors: ['RESTAURANT', 'ADMIN'],
    command: 'ReassignDelivery',
    requiresReason: true,
  },
  { from: 'ACCEPTED', to: 'PICKED_UP', actors: ['DRIVER'], command: 'ConfirmPickup' },
  { from: 'PICKED_UP', to: 'ARRIVED_CUSTOMER', actors: ['DRIVER'], command: 'ConfirmArrival' },
  // Delivery may be confirmed directly from PICKED_UP if the driver skips the arrival tap.
  { from: 'PICKED_UP', to: 'DELIVERED', actors: ['DRIVER', 'ADMIN'], command: 'ConfirmDelivery' },
  {
    from: 'ARRIVED_CUSTOMER',
    to: 'DELIVERED',
    actors: ['DRIVER', 'ADMIN'],
    command: 'ConfirmDelivery',
  },
  {
    from: 'ASSIGNED',
    to: 'CANCELLED',
    actors: ['RESTAURANT', 'ADMIN', 'SYSTEM'],
    command: 'CancelAssignment',
    requiresReason: true,
  },
  {
    from: 'ACCEPTED',
    to: 'CANCELLED',
    actors: ['RESTAURANT', 'ADMIN'],
    command: 'CancelAssignment',
    requiresReason: true,
  },
  {
    from: 'PICKED_UP',
    to: 'CANCELLED',
    actors: ['ADMIN'],
    command: 'CancelAssignment',
    requiresReason: true,
  },
];

/** An assignment in one of these states still gives the driver delivery rights. */
export const ACTIVE_DELIVERY_STATUSES: readonly DeliveryAssignmentStatus[] = [
  'ASSIGNED',
  'ACCEPTED',
  'PICKED_UP',
  'ARRIVED_CUSTOMER',
];

// ── Settlement ───────────────────────────────────────────────────────────────

export const SETTLEMENT_TRANSITIONS: readonly TransitionRule<SettlementStatus>[] = [
  { from: 'DRAFT', to: 'ISSUED', actors: ['ADMIN'], command: 'IssueSettlement' },
  { from: 'DRAFT', to: 'VOID', actors: ['ADMIN'], command: 'VoidSettlement', requiresReason: true },
  { from: 'ISSUED', to: 'PARTIALLY_PAID', actors: ['ADMIN', 'SYSTEM'], command: 'RecordPayment' },
  { from: 'ISSUED', to: 'PAID', actors: ['ADMIN', 'SYSTEM'], command: 'RecordPayment' },
  { from: 'ISSUED', to: 'OVERDUE', actors: ['SYSTEM'], command: 'MarkOverdue' },
  {
    from: 'ISSUED',
    to: 'DISPUTED',
    actors: ['RESTAURANT', 'ADMIN'],
    command: 'DisputeSettlement',
    requiresReason: true,
  },
  {
    from: 'PARTIALLY_PAID',
    to: 'PARTIALLY_PAID',
    actors: ['ADMIN', 'SYSTEM'],
    command: 'RecordPayment',
  },
  { from: 'PARTIALLY_PAID', to: 'PAID', actors: ['ADMIN', 'SYSTEM'], command: 'RecordPayment' },
  { from: 'PARTIALLY_PAID', to: 'OVERDUE', actors: ['SYSTEM'], command: 'MarkOverdue' },
  {
    from: 'PARTIALLY_PAID',
    to: 'DISPUTED',
    actors: ['RESTAURANT', 'ADMIN'],
    command: 'DisputeSettlement',
    requiresReason: true,
  },
  { from: 'OVERDUE', to: 'PARTIALLY_PAID', actors: ['ADMIN', 'SYSTEM'], command: 'RecordPayment' },
  { from: 'OVERDUE', to: 'PAID', actors: ['ADMIN', 'SYSTEM'], command: 'RecordPayment' },
  {
    from: 'OVERDUE',
    to: 'DISPUTED',
    actors: ['RESTAURANT', 'ADMIN'],
    command: 'DisputeSettlement',
    requiresReason: true,
  },
  {
    from: 'DISPUTED',
    to: 'ISSUED',
    actors: ['ADMIN'],
    command: 'ResolveDispute',
    requiresReason: true,
  },
  {
    from: 'DISPUTED',
    to: 'VOID',
    actors: ['ADMIN'],
    command: 'VoidSettlement',
    requiresReason: true,
  },
  // A paid statement can only be voided through an explicit, audited correction.
  { from: 'PAID', to: 'VOID', actors: ['ADMIN'], command: 'VoidSettlement', requiresReason: true },
];

// ── Generic machinery ────────────────────────────────────────────────────────

export interface TransitionCheck<S extends string> {
  readonly from: S;
  readonly to: S;
  readonly actorType: ActorType;
  readonly reason?: string | null;
}

export function findTransition<S extends string>(
  table: readonly TransitionRule<S>[],
  from: S,
  to: S,
): TransitionRule<S> | undefined {
  return table.find((rule) => rule.from === from && rule.to === to);
}

export function canTransition<S extends string>(
  table: readonly TransitionRule<S>[],
  check: TransitionCheck<S>,
): boolean {
  const rule = findTransition(table, check.from, check.to);
  if (!rule) return false;
  if (!rule.actors.includes(check.actorType)) return false;
  if (rule.requiresReason && !check.reason?.trim()) return false;
  return true;
}

/**
 * Assert a transition is legal, throwing the taxonomy error the client expects.
 * Every state-changing command routes through this.
 */
export function assertTransition<S extends string>(
  table: readonly TransitionRule<S>[],
  check: TransitionCheck<S>,
  notAllowedCode: (typeof ERROR_CODES)[
    'ORDER_CANNOT_TRANSITION' | 'DELIVERY_CANNOT_TRANSITION' | 'SETTLEMENT_INVALID_STATE'],
): TransitionRule<S> {
  const rule = findTransition(table, check.from, check.to);
  if (!rule) {
    throw new AppError(notAllowedCode, {
      details: { from: check.from, to: check.to, reason: 'NO_SUCH_TRANSITION' },
    });
  }
  if (!rule.actors.includes(check.actorType)) {
    throw new AppError(ERROR_CODES.FORBIDDEN, {
      details: {
        from: check.from,
        to: check.to,
        actorType: check.actorType,
        allowedActors: rule.actors,
      },
    });
  }
  if (rule.requiresReason && !check.reason?.trim()) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, {
      details: { field: 'reason', transition: rule.command, message: 'reason is required' },
    });
  }
  return rule;
}

/** All states reachable from `from` by `actorType` — powers UI action buttons. */
export function allowedNextStates<S extends string>(
  table: readonly TransitionRule<S>[],
  from: S,
  actorType: ActorType,
): S[] {
  return table.filter((r) => r.from === from && r.actors.includes(actorType)).map((r) => r.to);
}

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

export function isLiveOrderStatus(status: OrderStatus): boolean {
  return LIVE_ORDER_STATUSES.includes(status);
}

export function isActiveDeliveryStatus(status: DeliveryAssignmentStatus): boolean {
  return ACTIVE_DELIVERY_STATUSES.includes(status);
}
