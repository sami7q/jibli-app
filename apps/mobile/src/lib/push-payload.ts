/**
 * What the worker actually puts in a push payload.
 *
 * `apps/worker/src/jobs/outbox-publisher.ts` sends
 * `{ orderId, eventType, audience }` — and this file used to read `data.kind`,
 * a key nothing has ever sent. So `isOrder` was false for every notification
 * the platform produces: no sound and no high priority on exactly the messages
 * both were written for, silently, because a missing key reads as "not an
 * order" rather than as an error.
 *
 * Typed and parsed in one place so the next divergence is a type error rather
 * than a behaviour nobody notices.
 */

/**
 * Who the push is for, which decides where a tap lands: a customer's order
 * page, the shop's order board, or the courier's task.
 */
export type PushAudience = 'customer' | 'restaurant' | 'driver';

export interface OrderPushData {
  readonly orderId: string;
  readonly eventType: string;
  readonly audience: PushAudience;
}

const AUDIENCES: readonly PushAudience[] = ['customer', 'restaurant', 'driver'];

export function readOrderPush(data: unknown): OrderPushData | null {
  if (typeof data !== 'object' || data === null) return null;

  const { orderId, eventType, audience } = data as Record<string, unknown>;
  if (typeof orderId !== 'string' || orderId.length === 0) return null;

  return {
    orderId,
    eventType: typeof eventType === 'string' ? eventType : '',
    /*
     * A push from before the worker named its audience was always a
     * customer's — that was the only kind it sent with an order page to open.
     */
    audience: AUDIENCES.includes(audience as PushAudience)
      ? (audience as PushAudience)
      : 'customer',
  };
}

/**
 * A shop's approval: news for its new owner, sent to the shop's audience but
 * about no order at all (its `orderId` is the shop's id).
 */
export const SHOP_APPROVED = 'restaurant.approved';

/**
 * Whether a push is live work — a new order, a task — that the in-app engines
 * ring for themselves while the app is open. The approval is not: it has no
 * board to refresh, and swallowing its banner would hide the one message the
 * applicant has been waiting days for.
 */
export function isLiveWork(
  push: OrderPushData,
): push is OrderPushData & { readonly audience: 'restaurant' | 'driver' } {
  return push.audience !== 'customer' && push.eventType !== SHOP_APPROVED;
}

/** Where tapping a push should take its reader. */
export function pushDestination(push: OrderPushData): string {
  if (push.eventType === SHOP_APPROVED) return '/(owner)/owner';
  switch (push.audience) {
    case 'restaurant':
      return '/(owner)/orders';
    case 'driver':
      return '/(driver)/delivery';
    default:
      return `/order/${push.orderId}`;
  }
}
