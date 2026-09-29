import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import type * as ExpoNotifications from 'expo-notifications';
import { configNested } from './app-config';
import { useRouter } from 'expo-router';
import { apiRequest } from './api';
import { readOrderPush } from './push-payload';

/**
 * Push registration.
 *
 * `expo-notifications` has been a dependency since the project was created and
 * nothing imported it, so the app asked for `POST_NOTIFICATIONS` on Android and
 * then never used it — a permission prompt for a feature that does not exist,
 * which is the fastest way to teach someone to tap "deny".
 *
 * Three decisions worth stating, because each is the opposite of the default:
 *
 *   **Ask late.** Not at launch. A prompt on first open, before the customer
 *   has ordered anything, is denied — and on iOS a denial is close to
 *   permanent, since re-asking requires a trip to Settings. The right moment is
 *   just after a first order is placed, when "tell me when it arrives" is
 *   obviously in their interest, so this module exposes the call and the
 *   checkout flow decides when.
 *
 *   **Never fail the caller.** A customer who declines notifications has placed
 *   a perfectly good order. Every path here resolves.
 *
 *   **The token is not sensitive, the session is.** The token is posted to the
 *   API with the bearer token, which is what ties it to a user; the push token
 *   itself is a routing address and lives in ordinary storage.
 */

export { readOrderPush, type OrderPushData } from './push-payload';

/**
 * Where push can work at all.
 *
 * Not on the web, which has no notification module — `getLastNotificationResponse`
 * throws there, and took the whole web preview down with it. And not in Expo
 * Go: since SDK 53 it ships without remote push, and merely importing
 * `expo-notifications` there prints two warnings on every launch. Both are
 * development surfaces; a store or development build is neither.
 *
 * So the module is required only where it works, and everything below treats
 * its absence the way it already treated a simulator: not an error, just
 * nothing to do.
 */
export const PUSH_SUPPORTED =
  Platform.OS !== 'web' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

type NotificationsModule = typeof ExpoNotifications;

const Notifications: NotificationsModule | null = PUSH_SUPPORTED
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded only where it works
    (require('expo-notifications') as NotificationsModule)
  : null;

/** Foreground behaviour: an order update should interrupt, a promo should not. */
Notifications?.setNotificationHandler({
  handleNotification: async (notification) => {
    const isOrder = readOrderPush(notification.request.content.data) !== null;

    /*
     * `shouldShowAlert` was one switch; iOS 14 split the decision in two and
     * expo-notifications followed in SDK 54. A banner is the transient drop
     * from the top of the screen, the list is Notification Centre — and an
     * order update wants both: seen now if the phone is in hand, and still
     * there if it was not.
     */
    return {
      shouldShowBanner: true,
      shouldShowList: true,
      // A sound while the customer is already looking at the order they are
      // being told about is noise.
      shouldPlaySound: isOrder,
      shouldSetBadge: false,
      ...(isOrder && Notifications
        ? { priority: Notifications.AndroidNotificationPriority.HIGH }
        : {}),
    };
  },
});

export type PushOutcome =
  | { status: 'registered'; token: string }
  | { status: 'denied' }
  /** A simulator, or a build with no project id — neither is an error. */
  | { status: 'unavailable'; reason: string };

/**
 * Ask for permission, get a token, and tell the server.
 *
 * Call it at a moment the customer can see the point of — not at launch.
 */
export async function registerForPush(): Promise<PushOutcome> {
  try {
    if (!Notifications) {
      return { status: 'unavailable', reason: 'expo go or web' };
    }

    if (!Constants.isDevice) {
      return { status: 'unavailable', reason: 'simulator' };
    }

    /*
     * Android needs the channel to exist before the first notification, not
     * after: one that arrives without a channel is filed under a default the
     * user cannot configure, and cannot be moved later.
     */
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('orders', {
        name: 'حالة الطلبات',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 100, 200],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;

    // Only ask if it is still askable. Requesting again after a denial does
    // nothing on iOS and trains nobody.
    if (!granted && existing.canAskAgain) {
      const asked = await Notifications.requestPermissionsAsync();
      granted = asked.granted;
    }

    if (!granted) return { status: 'denied' };

    const projectId = configNested('eas', 'projectId') ?? Constants.easConfig?.projectId;

    if (!projectId) {
      // A development build before EAS is configured. Not a failure.
      return { status: 'unavailable', reason: 'no project id' };
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });

    // `/api/v1/devices`, not under /driver or /profile: the table is keyed on
    // the user, and a customer needs push for "your order was accepted"
    // exactly as a driver needs it for a new assignment.
    await apiRequest('/api/v1/devices', {
      method: 'POST',
      body: {
        push_token: token,
        platform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
        app_version: Constants.expoConfig?.version ?? '1.0.0',
      },
    });

    return { status: 'registered', token };
  } catch (error) {
    /*
     * Swallowed on purpose. Registration failing must never be the reason an
     * order does not get placed — see the note at the top of this file.
     */
    console.warn('Push registration failed', error);
    return { status: 'unavailable', reason: String(error) };
  }
}

// ── Opening the thing the notification is about ─────────────────────────────

/**
 * Take the customer to the order a notification is about.
 *
 * Without this, tapping «تم قبول طلبك» opened the app on the home screen and
 * left them to find the order themselves — which is most of the value of
 * sending the notification, thrown away at the last step. A push that does not
 * deep-link is a push that only tells you to go looking.
 *
 * Two entry points, because a notification arrives in two different worlds and
 * only one of them is an event:
 *
 *   **The app was running.** `addNotificationResponseReceivedListener` fires
 *   with the tap.
 *
 *   **The app was not running, and the tap started it.** There is no event to
 *   listen for — it happened before any listener existed.
 *   `useLastNotificationResponse` holds it instead, which is why this is a hook
 *   and not a function called once at startup.
 *
 * Mounted inside the router's tree (see `src/app/_layout.tsx`), because
 * navigating before the navigator exists is a no-op that loses the tap
 * silently.
 */
/**
 * The cold-start tap, or nothing where push is unsupported.
 *
 * Chosen once at module load, so every render calls the same hook — the rule
 * that makes a conditional hook safe.
 */
const useLastNotificationResponse: () => ReturnType<
  NotificationsModule['useLastNotificationResponse']
> = Notifications ? Notifications.useLastNotificationResponse : () => null;

export function usePushNavigation(): void {
  const router = useRouter();
  const last = useLastNotificationResponse();

  /*
   * The cold-start tap, handled once.
   *
   * `useLastNotificationResponse` keeps returning the same response for the
   * life of the process, so without the guard every re-render of the layout
   * would navigate again — including after the customer has deliberately
   * browsed somewhere else, which would drag them back to the order screen
   * until they force-quit.
   */
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!last) return;

    const id = last.notification.request.identifier;
    if (handled.current === id) return;
    handled.current = id;

    const payload = readOrderPush(last.notification.request.content.data);
    if (payload) router.push(`/order/${payload.orderId}`);
  }, [last, router]);

  useEffect(() => {
    if (!Notifications) return;

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      /*
       * The cold-start response is delivered here too on some platforms, so the
       * same guard applies — otherwise one tap navigates twice and the back
       * button has to be pressed twice to leave.
       */
      const id = response.notification.request.identifier;
      if (handled.current === id) return;
      handled.current = id;

      const payload = readOrderPush(response.notification.request.content.data);
      if (payload) router.push(`/order/${payload.orderId}`);
    });

    return () => subscription.remove();
  }, [router]);
}
