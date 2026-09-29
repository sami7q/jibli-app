/**
 * What the worker actually puts in a push payload.
 *
 * `apps/worker/src/jobs/outbox-publisher.ts` sends
 * `{ orderId, eventType }` — and this file used to read `data.kind`, a key
 * nothing has ever sent. So `isOrder` was false for every notification the
 * platform produces: no sound and no high priority on exactly the messages
 * both were written for, silently, because a missing key reads as "not an
 * order" rather than as an error.
 *
 * Typed and parsed in one place so the next divergence is a type error rather
 * than a behaviour nobody notices.
 */
export interface OrderPushData {
  readonly orderId: string;
  readonly eventType: string;
}

export function readOrderPush(data: unknown): OrderPushData | null {
  if (typeof data !== 'object' || data === null) return null;

  const { orderId, eventType } = data as Record<string, unknown>;
  if (typeof orderId !== 'string' || orderId.length === 0) return null;

  return { orderId, eventType: typeof eventType === 'string' ? eventType : '' };
}
