import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

/**
 * Fade and rise, once, on mount.
 *
 * Lifted out of the welcome screen, which had it inline. A second screen
 * wanting the same entrance is the point at which a local helper becomes a
 * shared one — and an app where two screens animate differently reads as two
 * apps.
 *
 * The rules it encodes, none of which are decorative:
 *
 *   **Native driver.** These run while the JS thread is still finishing a
 *   session resolve and a storefront fetch. An entrance that stutters during
 *   the first paint is worse than no entrance at all, and only the native
 *   driver survives a busy thread.
 *
 *   **Reduce motion is honoured, and assumed until proven otherwise.** The
 *   initial state is "animations off": `isReduceMotionEnabled` is async, so a
 *   default of `false` would start every animation and cancel it a frame
 *   later, which is precisely the flash the setting exists to prevent.
 *
 *   **A short rise, not a slide.** Twelve pixels reads as arrival; forty reads
 *   as a transition, and a customer who opens this screen ten times a day
 *   would be waiting for it by the third.
 */
export function Enter({
  children,
  delay = 0,
  distance = 12,
  duration = 320,
  style,
}: {
  children: React.ReactNode;
  /** Stagger, in milliseconds. Sections read top to bottom when they differ. */
  delay?: number;
  distance?: number;
  duration?: number;
  style?: React.ComponentProps<typeof Animated.View>['style'];
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let alive = true;

    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (alive) setReduceMotion(enabled);
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => alive && setReduceMotion(enabled),
    );

    return () => {
      alive = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      // Straight to the finished state: visible, in place, no transition.
      progress.setValue(1);
      return;
    }

    /*
     * Back to the start before running, and this is the whole reason anything
     * moves.
     *
     * The initial state is «reduced until proven otherwise», so the first pass
     * through this effect always sets `progress` to 1. When the async check
     * comes back saying motion is allowed, the effect re-runs — and animating
     * to 1 from 1 is a no-op. Every entrance in the app was silently arriving
     * finished: the component ran, the timing ran, and nothing ever moved.
     *
     * Resetting first is what makes the animation have somewhere to come from.
     */
    progress.setValue(0);

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      // Decelerating: fast to start, settling at the end. An entrance that
      // eases in as well arrives twice and feels slower than it is.
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });

    animation.start();
    return () => animation.stop();
  }, [reduceMotion, progress, delay, duration]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [distance, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
