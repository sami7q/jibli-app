import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useSession } from '@/lib/session';
import { color, palette, radius, space, TAP_TARGET } from '@/theme';
import { Screen, Text } from '@/ui';
import { IraqFlag, JibliWordmark } from '@/ui/brand';

/**
 * The first screen of a fresh install (`1.html`).
 *
 * It exists for two reasons at once. The comp's reason: the brand gets one
 * screen of its own before the product starts asking for things. The App
 * Store's reason (guideline 5.1.1(ii)): an app may not require an account to
 * see content that does not need one. Routing a signed-out customer straight
 * to «أدخل رقم هاتفك» — which is what this app did — is the shape of that
 * rejection, and `GET /storefront` and `GET /restaurants` are already public,
 * so there was never a technical reason for it.
 *
 * The phone number is asked for at checkout instead, where an account
 * genuinely is required: an order needs an address to go to and a number to
 * call about it.
 */

/** The food outlines drifting behind the mark, from the comp's doodle layer. */
const DOODLES = [
  { icon: 'taco', size: 150, top: '-2%', start: '-12%', rotate: '-12deg', drift: -8 },
  { icon: 'food-drumstick-outline', size: 120, top: '40%', start: '-8%', rotate: '38deg', drift: 7 },
  { icon: 'hamburger', size: 160, top: '62%', start: '-6%', rotate: '-6deg', drift: -9 },
  { icon: 'french-fries', size: 170, top: '44%', end: '-10%', rotate: '12deg', drift: 8 },
  { icon: 'pizza', size: 145, top: '70%', end: '28%', rotate: '-12deg', drift: -7 },
  { icon: 'popcorn', size: 130, top: '84%', end: '-6%', rotate: '-8deg', drift: 6 },
] as const;

export default function WelcomeScreen() {
  const router = useRouter();
  const { continueAsGuest } = useSession();
  const [reduceMotion, setReduceMotion] = useState(true);

  /*
   * Start with motion off and turn it on only once the OS has answered.
   * The other way round runs the entrance animation for a moment on a device
   * that asked not to see it, which is the one case that matters.
   */
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (alive) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  return (
    <Screen background={color.brand} padded={false}>
      <StatusBar style="light" />

      <DoodleLayer animate={!reduceMotion} />

      <View style={{ flex: 1, paddingHorizontal: space[6], justifyContent: 'space-between' }}>
        <Enter animate={!reduceMotion} delay={0} style={{ flex: 1, justifyContent: 'center' }}>
          <View style={{ alignItems: 'center' }}>
            <JibliWordmark width={248} />
            <Text variant="h1" tone="inverse" align="center" style={{ marginTop: space[4] }}>
              جيِبلي اللي تريده
            </Text>
            <Text
              variant="body"
              tone="inverse"
              align="center"
              style={{ marginTop: space[1], opacity: 0.9 }}
            >
              مذاق أقرب لك
            </Text>
          </View>
        </Enter>

        <Enter animate={!reduceMotion} delay={220} style={{ paddingBottom: space[6] }}>
          {/*
           * Sign in first, browsing second — the order matters. A customer
           * with an account should not have to hunt for the button, and a
           * first-timer still sees that they are allowed in without one.
           */}
          <Pressable
            onPress={() => router.push('/(auth)/phone')}
            accessibilityRole="button"
            accessibilityLabel="تسجيل الدخول"
            style={({ pressed }) => [
              {
                minHeight: TAP_TARGET + 8,
                borderRadius: radius.full,
                backgroundColor: palette.white,
                alignItems: 'center',
                justifyContent: 'center',
              },
              pressed ? { opacity: 0.85 } : null,
            ]}
          >
            <Text variant="bodyBold" tone="brand">
              تسجيل الدخول
            </Text>
          </Pressable>

          <Pressable
            onPress={() => void continueAsGuest()}
            accessibilityRole="button"
            accessibilityLabel="تصفح كضيف"
            accessibilityHint="تصفّح المطاعم دون حساب. سيُطلب رقمك عند إتمام الطلب."
            style={({ pressed }) => [
              {
                marginTop: space[3],
                minHeight: TAP_TARGET + 8,
                borderRadius: radius.full,
                borderWidth: 1.5,
                borderColor: 'rgba(255,255,255,0.55)',
                alignItems: 'center',
                justifyContent: 'center',
              },
              pressed ? { backgroundColor: 'rgba(255,255,255,0.14)' } : null,
            ]}
          >
            <Text variant="bodyBold" tone="inverse">
              تصفح كضيف
            </Text>
          </Pressable>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: space[2],
              marginTop: space[5],
            }}
          >
            <IraqFlag width={22} />
            <Text variant="caption" tone="inverse" style={{ opacity: 0.9 }}>
              صُنع للعراق
            </Text>
          </View>
        </Enter>
      </View>
    </Screen>
  );
}

/**
 * Fade and rise, once.
 *
 * `useNativeDriver` because this runs while the JS thread is still finishing
 * the session resolve — an entrance that stutters on the first launch is worse
 * than no entrance at all.
 */
function Enter({
  children,
  animate,
  delay,
  style,
}: {
  children: React.ReactNode;
  animate: boolean;
  delay: number;
  style?: React.ComponentProps<typeof Animated.View>['style'];
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate) {
      progress.setValue(1);
      return;
    }

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 640,
      delay,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [animate, delay, progress]);

  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
          ],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** The drifting food outlines. Decorative, so hidden from screen readers. */
function DoodleLayer({ animate }: { animate: boolean }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}
    >
      {DOODLES.map((doodle) => (
        <Doodle key={doodle.icon} doodle={doodle} animate={animate} />
      ))}
    </View>
  );
}

function Doodle({ doodle, animate }: { doodle: (typeof DOODLES)[number]; animate: boolean }) {
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate) return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: 1,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, float]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: doodle.top,
        ...('start' in doodle ? { insetInlineStart: doodle.start } : {}),
        ...('end' in doodle ? { insetInlineEnd: doodle.end } : {}),
        transform: [
          { rotate: doodle.rotate },
          {
            translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, doodle.drift] }),
          },
        ],
      }}
    >
      <MaterialCommunityIcons
        name={doodle.icon}
        size={doodle.size}
        color="rgba(255,255,255,0.13)"
      />
    </Animated.View>
  );
}

