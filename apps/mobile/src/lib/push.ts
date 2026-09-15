import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { apiRequest } from './api';

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

/** Foreground behaviour: an order update should interrupt, a promo should not. */
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const kind = notification.request.content.data?.['kind'];
    const isOrder = typeof kind === 'string' && kind.startsWith('order.');

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
      ...(isOrder ? { priority: Notifications.AndroidNotificationPriority.HIGH } : {}),
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

    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas
        ?.projectId ?? Constants.easConfig?.projectId;

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
