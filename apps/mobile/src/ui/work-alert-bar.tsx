import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import { useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatIqdArabic, iqd } from '@jibli/money';
import MaterialCommunityIcons from '@/ui/icon';
import { Text } from '@/ui';
import { NEW_ORDERS, countAr } from '@/lib/arabic-count';
import { summarizeNewOrder } from '@/lib/owner-catalog';
import { useWorkLive } from '@/lib/work-live';
import { BRAND, ROW, palette, radius, shadow, space } from '@/theme';

/**
 * The banner that says «there is someone waiting on you», over any screen.
 *
 * A shop owner reading their product list, or a courier looking at their cash,
 * is exactly who a new order needs to reach — so this floats over whatever is
 * showing rather than living on the board it points to. On that board (or on
 * the courier's task screen) it steps aside: the lane or the task card is
 * already the same news, larger.
 *
 * Near-black rather than the section colour: it has to stand out on an orange
 * screen, a green one and a pink one alike, and read as an alert rather than as
 * part of the page.
 */

const RLM = '\u200F';
const LRM = '\u200E';

/**
 * One Arabic caption that opens with an order number: `#JB7400808 · 64,500 د.ع · منذ 1 د`.
 *
 * Android takes a line's direction from its first strong character — React
 * Native lays text out with `FIRSTSTRONG_LTR` and has no `writingDirection` on
 * that platform — so a line opening with `JB…` was laid out left-to-right and
 * the Arabic after it reshuffled: «د.ع» landed two words away from its amount.
 * The right-to-left mark in front makes the line Arabic whatever it opens with;
 * the marks around the number keep `#JB7400808` one left-to-right token, `#`
 * included, without pulling the amount that follows into the same run.
 */
function orderLine(orderNumber: string, ...rest: string[]): string {
  return [`${RLM}${LRM}#${orderNumber}${RLM}`, ...rest].join(' · ');
}

interface Alert {
  readonly key: string;
  readonly role: 'owner' | 'driver';
  readonly icon: 'bell-ring' | 'moped' | 'package-variant-closed-check';
  readonly title: string;
  readonly detail: string;
  readonly href: string;
}

export function WorkAlertBar() {
  const router = useRouter();
  const segments = useSegments() as readonly string[];
  const insets = useSafeAreaInsets();
  const { owner, driver, ownerMuted, driverMuted, mute } = useWorkLive();

  const onBoard = segments[0] === '(owner)' && segments[1] === 'orders';
  const onTask = segments[0] === '(driver)' && segments[1] === 'delivery';

  let alert: Alert | null = null;

  // Muting hides the banner as well as the reminders — until something new arrives.
  if (owner.pending.length > 0 && !onBoard && !ownerMuted) {
    const oldest = owner.pending[0]!;
    const count = owner.pending.length;
    alert = {
      key: `owner:${oldest.id}:${count}`,
      role: 'owner',
      icon: 'bell-ring',
      title: `${countAr(count, NEW_ORDERS)} بانتظار قبولك`,
      // The customer, the count, the total and the district: what the owner
      // would ask on the phone, answered before the board is even open.
      detail: orderLine(
        oldest.public_order_number,
        summarizeNewOrder(oldest).line,
        oldest.age_minutes < 1 ? 'الآن' : `منذ ${oldest.age_minutes} د`,
      ),
      href: '/(owner)/orders',
    };
  } else if (driver.offer && !onTask && !driverMuted) {
    alert = {
      key: `offer:${driver.offer.assignment_id}`,
      role: 'driver',
      icon: 'moped',
      title: 'مهمة توصيل جديدة',
      detail: orderLine(
        driver.offer.public_order_number,
        `من ${driver.offer.restaurant_name}`,
        `تحصيل ${formatIqdArabic(iqd(driver.offer.cash_to_collect_iqd))}`,
      ),
      href: '/(driver)/delivery',
    };
  } else if (driver.readyToCollect && !onTask && !driverMuted) {
    alert = {
      key: `ready:${driver.readyToCollect.assignment_id}`,
      role: 'driver',
      icon: 'package-variant-closed-check',
      title: 'الطلب جاهز للاستلام',
      detail: orderLine(
        driver.readyToCollect.public_order_number,
        `من ${driver.readyToCollect.restaurant_name}`,
      ),
      href: '/(driver)/delivery',
    };
  }

  return alert ? (
    <AlertCard
      key={alert.key}
      alert={alert}
      top={insets.top + space[2]}
      onOpen={() => router.push(alert.href as never)}
      onMute={() => mute(alert.role)}
    />
  ) : null;
}

function AlertCard({
  alert,
  top,
  onOpen,
  onMute,
}: {
  alert: Alert;
  top: number;
  onOpen: () => void;
  onMute: () => void;
}) {
  const enter = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, friction: 8 }).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 520,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [enter, pulse]);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top,
        left: space[3],
        right: space[3],
        opacity: enter,
        transform: [
          { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) },
        ],
      }}
    >
      <View
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
        style={{
          flexDirection: ROW,
          alignItems: 'center',
          gap: space[3],
          paddingVertical: space[3],
          paddingHorizontal: space[3],
          borderRadius: radius.xl,
          backgroundColor: palette.ink[900],
          ...shadow.lg,
        }}
      >
        <Animated.View
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: BRAND[500],
            transform: [
              { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) },
            ],
          }}
        >
          <MaterialCommunityIcons name={alert.icon} size={22} color={palette.white} />
        </Animated.View>

        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`${alert.title}. ${alert.detail}. عرض`}
          style={{ flex: 1, gap: 2 }}
        >
          <Text variant="smallBold" tone="inverse" numberOfLines={1}>
            {alert.title}
          </Text>
          {/* Two lines: the courier's line ends with the cash to collect. */}
          <Text variant="caption" style={{ color: palette.ink[300] }} numberOfLines={2}>
            {alert.detail}
          </Text>
        </Pressable>

        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel="عرض"
          style={({ pressed }) => ({
            paddingVertical: space[2],
            paddingHorizontal: space[3],
            borderRadius: radius.full,
            backgroundColor: pressed ? BRAND[600] : BRAND[500],
          })}
        >
          <Text variant="smallBold" tone="inverse">
            عرض
          </Text>
        </Pressable>

        <Pressable
          onPress={onMute}
          accessibilityRole="button"
          accessibilityLabel="إسكات التنبيه وإخفاؤه حتى يصل جديد"
          hitSlop={space[2]}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 2 })}
        >
          <MaterialCommunityIcons name="bell-off-outline" size={20} color={palette.ink[300]} />
        </Pressable>
      </View>
    </Animated.View>
  );
}
