import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { BRAND } from '@/theme';
import { JibliWordmark, WORDMARK_ENTRANCE_MS } from '@/ui/brand';

/** How long the settled mark stays up before the intro lifts. */
const HOLD_MS = 450;
const FADE_MS = 320;
/** With reduced motion the mark is shown still, briefly, and simply removed. */
const STILL_MS = 700;

/**
 * The opening animation, on every launch.
 *
 * It used to live only on the welcome screen, so a customer who had signed in
 * once never saw it again: the app opened straight onto a list. The intro is
 * now drawn by the root over whatever screen the router is preparing beneath
 * it — signed in or not — and lifts once the mark has assembled. Routing runs
 * underneath in the meantime, so the screen it reveals is already the right
 * one and the intro costs no extra wait beyond the animation itself.
 */
export function LaunchIntro({ onDone }: { onDone: () => void }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (alive) setReduceMotion(enabled);
      })
      .catch(() => {
        if (alive) setReduceMotion(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion === null) return;
    const fade = Animated.timing(opacity, {
      toValue: 0,
      duration: reduceMotion ? 0 : FADE_MS,
      delay: reduceMotion ? STILL_MS : WORDMARK_ENTRANCE_MS + HOLD_MS,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });
    fade.start(({ finished }) => {
      if (finished) onDone();
    });
    return () => fade.stop();
  }, [reduceMotion, opacity, onDone]);

  return (
    <Animated.View
      // Holds touches until it lifts: nothing under it is meant to be pressed yet.
      pointerEvents="auto"
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: BRAND[500],
          alignItems: 'center',
          justifyContent: 'center',
          opacity,
          // The letters fly in from past the edges; on the web that widened
          // the page. A phone clips at the glass anyway.
          overflow: 'hidden',
          zIndex: 1000,
          elevation: 1000,
        },
      ]}
    >
      <StatusBar style="light" />
      {reduceMotion === null ? null : (
        <JibliWordmark animate={!reduceMotion} idle={false} width={236} />
      )}
    </Animated.View>
  );
}
