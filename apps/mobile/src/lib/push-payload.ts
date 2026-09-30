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

/** Where tapping a push should take its reader. */
export function pushDestination(push: OrderPushData): string {
  switch (push.audience) {
    case 'restaurant':
      return '/(owner)/orders';
    case 'driver':
      return '/(driver)/delivery';
    default:
      return `/order/${push.orderId}`;
  }
}
