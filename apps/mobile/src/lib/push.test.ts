import { describe, expect, it, vi } from 'vitest';

/**
 * The shape of a push payload, asserted against the sender.
 *
 * This file exists because the two halves had silently disagreed. The worker
 * sends `{ orderId, eventType }` (`apps/worker/src/jobs/outbox-publisher.ts`)
 * and the app read `data.kind` — a key nothing has ever sent. Reading a missing
 * key is not an error, it is `undefined`, so every order notification was
 * classified as "not an order": no sound, no high priority, on exactly the
 * messages both were written for. Nothing failed; it just quietly did the wrong
 * thing, on a device, in production.
 *
 * A contract that crosses a process boundary and is checked by neither side is
 * the kind that stays broken. These tests are that check.
 */

vi.mock('react-native', () => ({
  Platform: { OS: 'android', select: (spec: Record<string, unknown>) => spec.android },
}));

vi.mock('expo-notifications', () => ({
  setNotificationHandler: vi.fn(),
  setNotificationChannelAsync: vi.fn(),
  getPermissionsAsync: vi.fn(),
  requestPermissionsAsync: vi.fn(),
  getExpoPushTokenAsync: vi.fn(),
  addNotificationResponseReceivedListener: vi.fn(),
  useLastNotificationResponse: vi.fn(),
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { PUBLIC: 1 },
  AndroidNotificationPriority: { HIGH: 'high' },
}));

vi.mock('expo-constants', () => ({ default: { expoConfig: { version: '1.0.0', extra: {} } } }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked',
  setItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));

const { readOrderPush } = await import('./push');

describe('readOrderPush()', () => {
  it('reads the payload the worker actually sends', () => {
    // Copied from outbox-publisher.ts, deliberately: if that changes, this is
    // where the mismatch should surface.
    const sent = { orderId: '0195e2a1-0000-7000-8000-000000000001', eventType: 'order.accepted' };

    expect(readOrderPush(sent)).toEqual({
      orderId: '0195e2a1-0000-7000-8000-000000000001',
      eventType: 'order.accepted',
    });
  });

  it('still identifies an order when the event type is missing', () => {
    // The id is what makes it navigable; the event type only colours the copy.
    expect(readOrderPush({ orderId: 'abc' })).toEqual({ orderId: 'abc', eventType: '' });
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
