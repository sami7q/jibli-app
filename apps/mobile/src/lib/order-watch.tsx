import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform, Pressable, View } from 'react-native';
import { useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@jibli/contracts';
import { api } from './api';
import { playChime } from './chime';
import { useSession } from './session';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, radius, shadow, space, TAB_BAR_HEIGHT } from '@/theme';
import { Row, Text } from '@/ui';
import { RateOrderSheet } from '@/ui/rate-order';

/**
 * The order the customer is waiting for, watched from anywhere in the app.
 *
 * Until this existed, an order was only visible on the screen that showed it.
 * Someone who placed an order and went back to browsing had no idea the
 * restaurant had accepted it, and someone who closed the app and came back had
 * to remember to go looking. Three things follow from that, and they are all
 * the same fact seen from different screens:
 *
 *   - a bar, on every screen, saying where the order is
 *   - an announcement when that changes, rather than a number that silently
 *     differs from the one read a minute ago
 *   - the order itself, opened on launch, because a customer who opens this
 *     app while waiting for food opened it to check on the food
 *
 * Polled rather than pushed. The API has a realtime gateway and the app has no
 * client for it; push covers a closed app and needs a provider that is not
 * connected yet. A twenty-second poll while something is moving is honest
 * about what it costs and works in every one of those cases today.
 */

/**
 * The journey, in the order it happens.
 *
 * Shared with the order screen rather than copied: the card's progress bar and
 * the screen's timeline are two drawings of one sequence, and two lists would
 * eventually disagree about where an order is.
 */
export const ORDER_JOURNEY = [
  'PLACED',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const satisfies readonly OrderStatus[];

/** Statuses an order can still move on from. */
export const LIVE_ORDER_STATUSES = [
  'PLACED',
  'PENDING_RESTAURANT',
  'ACCEPTED',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
] as const satisfies readonly OrderStatus[];

const LIVE = new Set<string>(LIVE_ORDER_STATUSES);
const KNOWN = new Set<string>(Object.keys(ORDER_STATUS_LABELS));

export function isLiveOrderStatus(status: string): boolean {
  return LIVE.has(status);
}

export interface ActiveOrder {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly restaurantName: string | null;
}

interface Announcement {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly restaurantName: string | null;
  readonly status: OrderStatus;
  readonly text: string;
}

interface OrderWatch {
  readonly active: ActiveOrder | null;
  readonly announcement: Announcement | null;
}

const OrderWatchContext = createContext<OrderWatch>({ active: null, announcement: null });

export function useOrderWatch(): OrderWatch {
  return useContext(OrderWatchContext);
}

/**
 * What to say when a status changes.
 *
 * The plain «تم تحديث طلبك إلى كذا» is right for the middle of the journey and
 * wrong at both ends: nobody needs to be told their delivered order was
 * "updated to delivered".
 */
export function announcementFor(status: OrderStatus): string {
  switch (status) {
    case 'ACCEPTED':
      return 'قبل المطعم طلبك وسيبدأ التحضير';
    case 'OUT_FOR_DELIVERY':
      return 'طلبك في الطريق إليك الآن';
    case 'DELIVERED':
    case 'COMPLETED':
      return 'تم تسليم طلبك — بالعافية';
    case 'REJECTED':
      return 'للأسف تعذّر على المطعم قبول طلبك';
    case 'CANCELLED':
      return 'تم إلغاء طلبك';
    default:
      return `تم تحديث طلبك إلى «${ORDER_STATUS_LABELS[status]}»`;
  }
}

/**
 * The same words, as a notification the phone draws.
 *
 * Imported at the point of use rather than at the top of the file: the web
 * preview has no notification system, and `expo-notifications` reaching the
 * browser bundle is a module that throws where an in-app bar would have done
 * the job. Failing here is never worth surfacing — the bar has already said
 * the same sentence.
 */
async function notifyOnDevice(body: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const notifications = await import('expo-notifications');
    await notifications.scheduleNotificationAsync({
      content: { title: 'جيبلي', body, data: { kind: 'order.status' } },
      trigger: null,
    });
  } catch {
    /* no notification permission, or a build without the module */
  }
}

export function OrderWatchProvider({ children }: { children: ReactNode }) {
  const { state } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const segments = useSegments() as readonly string[];

  const signedIn = state.status === 'ready' || state.status === 'offline-ready';

  const orders = useQuery({
    // The same key the «طلباتي» tab uses, so the two share one fetch rather
    // than polling the same endpoint twice at different intervals.
    queryKey: ['my-orders'],
    queryFn: () => api.myOrders(),
    enabled: signedIn,
    /*
     * Twenty seconds while something is moving, and nothing at all otherwise.
     * A customer with no live order is the common case, and polling for them
     * would keep the radio awake to learn that nothing happened.
     */
    refetchInterval: (query) =>
      (query.state.data ?? []).some((order) => isLiveOrderStatus(order.status)) ? 20_000 : false,
  });

  const active = useMemo<ActiveOrder | null>(() => {
    const live = (orders.data ?? []).filter((order) => isLiveOrderStatus(order.status));
    if (live.length === 0) return null;

    // Newest first, defensively: two live orders is unusual but legal, and the
    // one the customer means is the one they just placed.
    const newest = [...live].sort((a, b) => b.placed_at.localeCompare(a.placed_at))[0];
    if (!newest) return null;

    return {
      id: newest.id,
      orderNumber: newest.public_order_number,
      status: newest.status as OrderStatus,
      restaurantName: newest.restaurant_name,
    };
  }, [orders.data]);

  // ── Announcing a change ───────────────────────────────────────────────────

  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  /** Status per order as last read. `null` means nothing has been read yet. */
  const seen = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    const list = orders.data;
    if (!list) return;

    const next = new Map(list.filter((o) => KNOWN.has(o.status)).map((o) => [o.id, o.status]));
    const previous = seen.current;
    seen.current = next;

    /*
     * The first read of a launch teaches, it does not announce.
     *
     * Otherwise opening the app would immediately declare an update for a
     * status the customer already knew — and the one thing worse than missing
     * a notification is one that is telling you something you were told
     * yesterday.
     */
    if (!previous) return;

    for (const [id, status] of next) {
      const before = previous.get(id);
      if (!before || before === status) continue;

      const order = list.find((o) => o.id === id);
      const text = announcementFor(status as OrderStatus);

      /*
       * Sound and the inbox, together with the bar.
       *
       * The chime is the part a customer who is not looking at the screen
       * actually receives, and the refetch is what puts the same update in the
       * notification centre — so the three surfaces never disagree about what
       * happened.
       */
      void playChime();
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });

      setAnnouncement({
        orderId: id,
        orderNumber: order?.public_order_number ?? '',
        restaurantName: order?.restaurant_name ?? null,
        status: status as OrderStatus,
        text,
      });
      void notifyOnDevice(text);
      // One at a time. Two orders changing between two polls is rare enough
      // that a queue would be more machinery than the case deserves.
      break;
    }
  }, [orders.data, queryClient]);

  // The bar settles back to the plain status line; it is an announcement, not
  // a permanent header.
  useEffect(() => {
    if (!announcement) return;
    const timer = setTimeout(() => setAnnouncement(null), 8000);
    return () => clearTimeout(timer);
  }, [announcement]);

  /*
   * A poll is suspended while the app is backgrounded, so the first thing to
   * do on coming back is ask — before the customer has time to wonder.
   */
  useEffect(() => {
    if (!signedIn) return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void queryClient.invalidateQueries({ queryKey: ['my-orders'] });
      void queryClient.invalidateQueries({ queryKey: ['pending-reviews'] });
    });
    return () => subscription.remove();
  }, [signedIn, queryClient]);

  // ── Opening the order on launch ───────────────────────────────────────────

  const jumped = useRef(false);

  /*
   * Whether the router can be navigated yet.
   *
   * `segments` fills in before the root navigator has finished mounting, and
   * pushing in that window throws «Attempted to navigate before mounting the
   * Root Layout component» — which is exactly what a provider that navigates
   * from an effect at the root will hit on a cold start, every time, because
   * it is the first thing to run. `state.key` is only set once navigation is
   * actually ready.
   */
  const navigationState = useRootNavigationState();
  const navigationReady = Boolean(navigationState?.key);

  useEffect(() => {
    if (jumped.current || !active || !navigationReady) return;

    /*
     * Only from a tab. Taking the screen away from someone who is filling in
     * an address, reading a menu or signing in would be a worse interruption
     * than the one it saves — and checkout already lands on this same screen
     * by itself.
     */
    if (segments[0] !== '(tabs)') return;

    jumped.current = true;
    router.push(`/order/${active.id}`);
  }, [active, navigationReady, segments, router]);

  // ── The rating window, a quarter of an hour after delivery ────────────────

  const pending = useQuery({
    queryKey: ['pending-reviews'],
    queryFn: () => api.pendingReviews(),
    enabled: signedIn,
    staleTime: 60_000,
  });

  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const prompt = (pending.data ?? []).find((entry) => !dismissed.includes(entry.order_id)) ?? null;

  // Never over sign-in or the mandatory profile: those screens are a sequence
  // the customer has to finish, and a sheet over them is a dead end.
  const canPrompt = signedIn && segments[0] !== '(auth)';

  const value = useMemo<OrderWatch>(() => ({ active, announcement }), [active, announcement]);

  return (
    <OrderWatchContext.Provider value={value}>
      {children}
      {prompt && canPrompt ? (
        <RateOrderSheet
          visible
          orderId={prompt.order_id}
          restaurantName={prompt.restaurant_name}
          onClose={() => setDismissed((list) => [...list, prompt.order_id])}
          onSubmitted={() => {
            setDismissed((list) => [...list, prompt.order_id]);
            void queryClient.invalidateQueries({ queryKey: ['pending-reviews'] });
          }}
        />
      ) : null}
    </OrderWatchContext.Provider>
  );
}

/**
 * Where the order is — a card that floats just above the tab bar.
 *
 * It began as a full-width strip pinned to the very top of the screen, which
 * was the wrong half of the phone in three separate ways: it sat over the
 * app's own header so two bars stacked, it was the first thing the eye hit on
 * a screen whose subject is restaurants, and it was nowhere near the thumb
 * that would tap it. Every app that tracks something in the background — a
 * ride, a delivery, a song — docks it at the bottom instead, and they are
 * right: it is a thing you glance at and reach for, not a thing you read.
 *
 * One card, two states. Resting, it is a white surface with the status, the
 * restaurant, and a hairline of progress. When something changes it turns
 * brand-coloured and says what happened, then settles back. Two separate
 * elements would have meant a transient one covering a permanent one.
 */
/**
 * Screens that already dock something at the bottom of the screen.
 *
 * The restaurant menu floats a cart button at `bottom: space[6]` with the same
 * side insets — the card would land on top of it — and the cart and checkout
 * both end in the button the customer came to press. A card about an older
 * order covering the way to place a new one is worse than not showing it at
 * all, and the tab bar still says «طلباتي».
 */
const SCREENS_WITH_THEIR_OWN_DOCK = new Set(['(auth)', '(driver)', 'cart', 'checkout', 'restaurant']);

export function ActiveOrderBar() {
  const { active, announcement } = useOrderWatch();
  const router = useRouter();
  const segments = useSegments() as readonly string[];
  const insets = useSafeAreaInsets();

  if (SCREENS_WITH_THEIR_OWN_DOCK.has(segments[0] ?? '')) return null;

  /*
   * Over the order screen the announcement stays and the resting card goes.
   *
   * The quiet line is redundant there — the page behind it says the same thing
   * in full. The announcement is not, and this is the case that matters: a
   * customer watching the tracking screen when the kitchen starts cooking sees
   * a timeline row silently repaint, which is not being told anything.
   */
  if (segments[0] === 'order' && !announcement) return null;

  /*
   * An announcement outlives the order it is about — «تم تسليم طلبك» arrives
   * exactly when the order stops being active — so it decides whether there is
   * anything to draw, and the live order is the fallback.
   */
  const showing = announcement
    ? {
        orderId: announcement.orderId,
        orderNumber: announcement.orderNumber,
        restaurantName: announcement.restaurantName,
        status: announcement.status,
        headline: announcement.text,
        announcing: true,
      }
    : active
      ? {
          orderId: active.id,
          orderNumber: active.orderNumber,
          restaurantName: active.restaurantName,
          status: active.status,
          headline: ORDER_STATUS_LABELS[active.status],
          announcing: false,
        }
      : null;

  if (!showing) return null;

  const { announcing } = showing;
  const onTabs = segments[0] === '(tabs)';

  // How far along the journey, as a fraction. PENDING_RESTAURANT is the same
  // moment as PLACED from the customer's side, so it reads as the first step.
  const reached = ORDER_JOURNEY.indexOf(
    showing.status === 'PENDING_RESTAURANT' ? 'PLACED' : (showing.status as never),
  );
  const progress = reached < 0 ? 1 : (reached + 1) / ORDER_JOURNEY.length;

  const subtitle = [showing.restaurantName, showing.orderNumber].filter(Boolean).join(' · ');

  return (
    <View
      // `box-none` so the card takes taps and the gap around it does not: an
      // invisible full-width layer over the tab bar would swallow every tap
      // meant for the tab under it.
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        // `left`/`right` rather than `start`/`end`: the two insets are equal,
        // so there is nothing for a direction-aware property to decide, and
        // physical sides behave identically on every renderer.
        left: space[4],
        right: space[4],
        bottom: (onTabs ? TAB_BAR_HEIGHT : insets.bottom) + space[3],
      }}
    >
      <Pressable
        onPress={() => router.push(`/order/${showing.orderId}`)}
        accessibilityRole="button"
        accessibilityLabel={`${showing.headline}. ${subtitle}. اضغط لمتابعة الطلب`}
        // A change should be read out when it lands, not when the card is next
        // focused — this is the one part of the screen that speaks on its own.
        accessibilityLiveRegion="polite"
        style={({ pressed }) => [
          {
            borderRadius: radius.lg,
            backgroundColor: announcing ? color.brand : color.surfaceCard,
            borderWidth: 1,
            borderColor: announcing ? color.brandDeep : color.borderSubtle,
            // Clips the progress hairline to the rounded corners.
            overflow: 'hidden',
          },
          shadow.lg,
          pressed ? { opacity: 0.9 } : null,
        ]}
      >
        <Row gap={space[3]} style={{ padding: space[3] }}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: radius.full,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: announcing ? 'rgba(255,255,255,0.22)' : color.brandSoft,
            }}
          >
            <MaterialCommunityIcons
              name={announcing ? 'bell-ring' : 'moped'}
              size={21}
              color={announcing ? color.textInverse : color.brand}
            />
          </View>

          <View style={{ flex: 1, gap: 2 }}>
            <Text
              variant="smallBold"
              tone={announcing ? 'inverse' : 'primary'}
              numberOfLines={1}
            >
              {showing.headline}
            </Text>
            {subtitle ? (
              <Text variant="caption" tone={announcing ? 'inverse' : 'muted'} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>

          <MaterialCommunityIcons
            name="chevron-left"
            size={22}
            color={announcing ? color.textInverse : color.textMuted}
          />
        </Row>

        {/*
          * A hairline, not a progress bar with a label.
          *
          * The words above already say where the order is; this only answers
          * "roughly how much is left", which is the question a glance asks.
          */}
        <View
          style={{
            height: 3,
            backgroundColor: announcing ? 'rgba(255,255,255,0.28)' : color.surfaceSunken,
          }}
        >
          <View
            style={{
              height: 3,
              width: `${Math.round(progress * 100)}%`,
              backgroundColor: announcing ? color.textInverse : color.brand,
            }}
          />
        </View>
      </Pressable>
    </View>
  );
}
