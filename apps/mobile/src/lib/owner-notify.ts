import { Platform } from 'react-native';
import type { OwnerLiveOrder } from './api';
import { summarizeNewOrder } from './owner-catalog';
import { PUSH_SUPPORTED } from './push';

/**
 * A new order, announced by the phone itself.
 *
 * With the app in front, the live engine rings and draws its own banner. In
 * the background — the owner switched to WhatsApp, the screen went dark on
 * the counter — the engine can still learn about an order for a while, but
 * nothing it draws is visible. This puts the order in the notification tray
 * with the facts the owner would otherwise open the app to read: who, what,
 * how much, where.
 *
 * It is the same shape the server's push carries (`audience: 'restaurant'`,
 * the order id), so a tap lands on the board exactly as a remote push does.
 * When the platform's push provider is switched on, an owner may see both
 * for the same order; that costs one duplicate notification, and the
 * alternative — no notification until then — costs orders.
 */
export async function notifyNewOrderOnDevice(order: OwnerLiveOrder): Promise<void> {
  if (!PUSH_SUPPORTED) return;
  try {
    const notifications = await import('expo-notifications');
    const summary = summarizeNewOrder(order);
    await notifications.scheduleNotificationAsync({
      // One per order: a second poll that sees the same order replaces, not repeats.
      identifier: `owner-order:${order.id}`,
      content: {
        title: summary.title,
        body: summary.body,
        sound: 'new_order.wav',
        data: { orderId: order.id, eventType: 'order.placed', audience: 'restaurant', local: true },
        ...(Platform.OS === 'android'
          ? { priority: notifications.AndroidNotificationPriority.MAX }
          : {}),
      },
      // The `work` channel (see push.ts) carries the new-order chime on Android.
      trigger: Platform.OS === 'android' ? { channelId: 'work' } : null,
    });
  } catch {
    /* No permission, or a build without the module: the banner and the ring still stand. */
  }
}
