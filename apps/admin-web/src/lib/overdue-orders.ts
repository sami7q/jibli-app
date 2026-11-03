import type { AdminOrder } from './admin-endpoints';

/** How long a shop has to accept before the operator is told to call it. */
export const ACCEPT_DEADLINE_MS = 3 * 60_000;

/** Statuses in which the order is still waiting on the shop to accept. */
const AWAITING_SHOP = new Set(['PLACED', 'PENDING_RESTAURANT']);

export interface OverdueOrder {
  readonly order: AdminOrder;
  readonly waitingMinutes: number;
}

/**
 * Orders the shop has not accepted within three minutes, longest wait first.
 *
 * A push that never reached the shop's phone looks exactly like a busy shop
 * from the server's side; the only reliable fallback is a person who sees
 * the order waiting and phones the shop.
 */
export function overdueOrders(rows: readonly AdminOrder[], now: number): OverdueOrder[] {
  return rows
    .filter((order) => AWAITING_SHOP.has(order.status))
    .map((order) => ({ order, waited: now - new Date(order.placed_at).getTime() }))
    .filter(({ waited }) => waited >= ACCEPT_DEADLINE_MS)
    .sort((a, b) => b.waited - a.waited)
    .map(({ order, waited }) => ({ order, waitingMinutes: Math.floor(waited / 60_000) }));
}
