import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@/ui/icon';
import { useSession } from '@/lib/session';
import { clearAfterSignIn } from '@/lib/after-sign-in';
import { SECTIONS, SECTION_ORDER } from '@/lib/sections';
import { BRAND, ROW, TAP_TARGET, palette, radius, space } from '@/theme';
import { Button, Screen, Text } from '@/ui';
import { JibliWordmark, WORDMARK_ENTRANCE_MS } from '@/ui/brand';

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
 *
 * Two zones, not one. The brand has the top of the screen to itself — the
 * mark, the line, and the three sections it now stands for — and the two
 * things a person can do sit in a white sheet across the bottom. They used to
 * float on the orange among the doodles, one white and one outlined, which
 * made the decision look like part of the decoration. On the sheet they are
 * the same buttons every other screen uses, in the same order.
 */

/**
 * The outlines drifting behind the mark, from the comp's doodle layer.
 *
 * Six, all in the brand's half of the screen: the sheet covers the bottom, so
 * anything placed there would be drawn for nothing. Food still leads, and a
 * basket and a lipstick have joined it, because the app is no longer only the
 * restaurants.
 *
 * Placed by physical side rather than by `start`/`end`. This is a composition,
 * not a reading order — the taco is where it is because of what is next to it,
 * and a logical side would silently mirror the whole scatter on the day the
 * native RTL flag finally takes.
 */
const DOODLES = [
  { icon: 'taco', size: 140, top: '-3%', left: '-10%', rotate: '-12deg', drift: -8 },
  { icon: 'pizza', size: 128, top: '5%', right: '-8%', rotate: '14deg', drift: 7 },
  { icon: 'basket-outline', size: 118, top: '29%', left: '-9%', rotate: '10deg', drift: -7 },
  { icon: 'lipstick', size: 104, top: '33%', right: '-3%', rotate: '-18deg', drift: 8 },
  { icon: 'hamburger', size: 136, top: '50%', left: '-7%', rotate: '-6deg', drift: 6 },
  { icon: 'french-fries', size: 136, top: '47%', right: '-9%', rotate: '10deg', drift: -9 },
] as const;

/** The sheet's corner — the same curve the bottom sheets in the app open with. */
const SHEET_RADIUS = radius['3xl'];

export default function WelcomeScreen() {
  const router = useRouter();
  const { continueAsGuest } = useSession();
  const insets = useSafeAreaInsets();
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
    /*
     * Only the top edge is the screen's own: the sheet runs to the bottom of
     * the glass and pads itself past the home indicator, so the white reaches
     * the edge instead of stopping above an orange strip.
     */
    <Screen
      background={BRAND[500]}
      padded={false}
      edges={['top']}
      // Clipped at the root: the doodles and the assembling mark reach past
      // the edges on purpose, and on the web that widened the page and
      // scrolled the whole screen sideways. A phone clips at the glass anyway.
      style={{ overflow: 'hidden' }}
    >
      <StatusBar style="light" />

      <DoodleLayer animate={!reduceMotion} />

      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: space[6],
          // Lifted a little: centred exactly in the space above the sheet
          // reads as sitting low, because the sheet's white edge draws the eye.
          paddingBottom: space[6],
        }}
      >
        {/*
         * The mark assembles itself here, and only here.
         *
         * This is the first thing anybody sees of Jibli, and it was
         * arriving as a finished picture inside a block that faded up —
         * indistinguishable from a static splash. `animate` draws the
         * letters in from the outside, which is the one moment in the app
         * where a logo doing something is a welcome rather than a delay.
         *
         * It is not wrapped in the block's own `Enter`: two entrances on the
         * same element fight each other, and the letters were gathering
         * inside something that was still rising.
         */}
        <JibliWordmark animate width={236} />

        <Enter
          animate={!reduceMotion}
          delay={WORDMARK_ENTRANCE_MS}
          style={{ alignItems: 'center', alignSelf: 'stretch' }}
        >
          <Text
            variant="display"
            tone="inverse"
            align="center"
            // A generous line: Android clips glyphs to the line box, and at a
            // tight height Cairo's final yeh lost the dots that make it a yeh —
            // «جيبلي اللي» read as «جيبلى اللى».
            style={{ marginTop: space[5], fontSize: 32, lineHeight: 54 }}
          >
            جيبلي اللي أريده
          </Text>
          <Text
            variant="body"
            tone="inverse"
            align="center"
            style={{ marginTop: space[1], opacity: 0.88 }}
          >
            مذاق أقرب لك
          </Text>

          {/*
           * What Jibli is, in three words — the same three the chooser
           * offers on the next screen, in the same order, so the first
           * screen and the second agree about what the app contains.
           */}
          <View
            accessibilityRole="text"
            accessibilityLabel={`الأقسام: ${SECTION_ORDER.map((type) => SECTIONS[type].shortName).join('، ')}`}
            style={{
              flexDirection: ROW,
              justifyContent: 'center',
              gap: space[2],
              marginTop: space[6],
            }}
          >
            {SECTION_ORDER.map((type) => (
              <View
                key={type}
                style={{
                  flexDirection: ROW,
                  alignItems: 'center',
                  gap: 6,
                  height: 34,
                  paddingHorizontal: 14,
                  borderRadius: radius.full,
                  backgroundColor: 'rgba(255,255,255,0.16)',
                  borderWidth: 1,
                  borderColor: 'rgba(255,255,255,0.26)',
                }}
              >
                <MaterialCommunityIcons
                  name={SECTIONS[type].icon}
                  size={15}
                  color={palette.white}
                />
                <Text variant="captionBold" tone="inverse">
                  {SECTIONS[type].shortName}
                </Text>
              </View>
            ))}
          </View>
        </Enter>
      </View>

      {/*
        The sheet comes after the mark has finished, not alongside it.
        «حتى تكتمل ثم تدخل»: the word assembles, the pin lands, and only then
        is there something to press — which is what makes the entrance an
        entrance rather than a logo animating over a screen you are already
        using.
      */}
      <Enter animate={!reduceMotion} delay={WORDMARK_ENTRANCE_MS + 120}>
        <View
          style={{
            backgroundColor: palette.white,
            borderTopLeftRadius: SHEET_RADIUS,
            borderTopRightRadius: SHEET_RADIUS,
            paddingHorizontal: space[5],
            paddingTop: space[6],
            paddingBottom: Math.max(insets.bottom, space[4]) + space[4],
            gap: space[3],
          }}
        >
          {/*
           * Sign in first, browsing second — the order matters. A customer
           * with an account should not have to hunt for the button, and a
           * first-timer still sees that they are allowed in without one.
           */}
          <Button
            label="تسجيل الدخول"
            size="lg"
            block
            onPress={() => {
              // A plain sign-in goes home, whatever was started and abandoned.
              clearAfterSignIn();
              router.push('/(auth)/phone');
            }}
          />
          <Button
            label="تصفح كضيف"
            variant="secondary"
            size="lg"
            block
            onPress={() => {
              clearAfterSignIn();
              void continueAsGuest();
            }}
          />

          {/*
           * The one thing worth knowing before choosing: browsing costs
           * nothing, and the number is asked for only when an order needs it.
           * It replaces the flag line that stood here, which said nothing
           * anyone was deciding on.
           */}
          <Text variant="caption" tone="muted" align="center" style={{ marginTop: space[1] }}>
            تصفّح بلا حساب، ويُطلب رقمك عند إتمام الطلب فقط
          </Text>

          {/*
           * The door for sellers — to the question, not to a form.
           *
           * It used to start the phone sign-in with the application form as
           * the destination, which was right for a first-time applicant and
           * wrong for the owner of a shop the team had already issued a login
           * for: they were asked to register a shop that exists. «صاحب متجر؟»
           * asks which of the two they are before anything is asked of them.
           */}
          <Pressable
            onPress={() => router.push('/(auth)/partner')}
            accessibilityRole="button"
            accessibilityLabel="صاحب متجر؟ سجّل متجرك في جيبلي"
            style={({ pressed }) => ({
              flexDirection: ROW,
              alignItems: 'center',
              justifyContent: 'center',
              gap: space[2],
              minHeight: TAP_TARGET,
              marginTop: space[1],
              borderTopWidth: 1,
              borderTopColor: palette.ink[100],
              paddingTop: space[3],
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <MaterialCommunityIcons name="storefront-outline" size={20} color={BRAND[600]} />
            <Text variant="smallBold" style={{ color: BRAND[600] }}>
              صاحب متجر؟ سجّل متجرك في جيبلي
            </Text>
          </Pressable>
        </View>
      </Enter>
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

/** The drifting outlines. Decorative, so hidden from screen readers. */
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
        ...('left' in doodle ? { left: doodle.left } : {}),
        ...('right' in doodle ? { right: doodle.right } : {}),
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
        color="rgba(255,255,255,0.12)"
      />
    </Animated.View>
  );
}
