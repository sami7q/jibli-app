import { describe, expect, it } from 'vitest';
import { pushDestination, readOrderPush } from './push-payload';

/**
 * The shape of a push payload, asserted against the sender.
 *
 * This file exists because the two halves had silently disagreed. The worker
 * sends `{ orderId, eventType }` (`apps/worker/src/jobs/outbox-publisher.ts`)
 * and the app read `data.kind` â€” a key nothing has ever sent. Reading a missing
 * key is not an error, it is `undefined`, so every order notification was
 * classified as "not an order": no sound, no high priority, on exactly the
 * messages both were written for. Nothing failed; it just quietly did the wrong
 * thing, on a device, in production.
 *
 * A contract that crosses a process boundary and is checked by neither side is
 * the kind that stays broken. These tests are that check.
 */

// The parser has no native dependencies, so it is tested without mocking any.

describe('readOrderPush()', () => {
  it('reads the payload the worker actually sends', () => {
    // Copied from outbox-publisher.ts, deliberately: if that changes, this is
    // where the mismatch should surface.
    const sent = { orderId: '0195e2a1-0000-7000-8000-000000000001', eventType: 'order.accepted' };

    expect(readOrderPush(sent)).toEqual({
      orderId: '0195e2a1-0000-7000-8000-000000000001',
      eventType: 'order.accepted',
      audience: 'customer',
    });
  });

  it('still identifies an order when the event type is missing', () => {
    // The id is what makes it navigable; the event type only colours the copy.
    expect(readOrderPush({ orderId: 'abc' })).toEqual({
      orderId: 'abc',
      eventType: '',
      audience: 'customer',
    });
  });

  it('rejects the key the app used to look for', () => {
    // The original bug, pinned: `kind` alone must not read as an order, or the
    // regression would be invisible again.
    expect(readOrderPush({ kind: 'order.accepted' })).toBeNull();
  });

  it.each([
    ['nothing at all', undefined],
    ['null', null],
    ['a string', 'order.accepted'],
    ['an empty object', {}],
    ['a blank id', { orderId: '' }],
    ['a non-string id', { orderId: 42 }],
  ])('treats %s as not an order', (_label, payload) => {
    expect(readOrderPush(payload)).toBeNull();
  });
});

describe('where a push opens', () => {
  it('takes a shop owner to the order board', () => {
    const push = readOrderPush({
      orderId: 'o1',
      eventType: 'order.placed',
      audience: 'restaurant',
    });
    expect(push?.audience).toBe('restaurant');
    expect(pushDestination(push!)).toBe('/(owner)/orders');
  });

  it('takes a courier to the delivery screen', () => {
    const push = readOrderPush({
      orderId: 'o1',
      eventType: 'delivery.assigned',
      audience: 'driver',
    });
    expect(pushDestination(push!)).toBe('/(driver)/delivery');
  });

  it('takes a customer to their order', () => {
    const push = readOrderPush({ orderId: 'o1', eventType: 'order.ready', audience: 'customer' });
    expect(pushDestination(push!)).toBe('/order/o1');
  });

  it('treats a push from before audiences existed as a customer update', () => {
    // Sent by a worker deployed before this change: no audience key at all.
    const push = readOrderPush({ orderId: 'o1', eventType: 'order.accepted' });
    expect(pushDestination(push!)).toBe('/order/o1');
  });

  it('does not trust an audience it does not know', () => {
    expect(readOrderPush({ orderId: 'o1', audience: 'admin' })?.audience).toBe('customer');
  });
});
