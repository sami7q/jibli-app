import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';
import { BRAND, palette } from '@/theme';

/**
 * The wordmark.
 *
 * Transcribed from the design comp's vector rather than approximated with a
 * bold font: the J's dot is a location pin, which is the whole idea of the
 * mark — «جيبلي», bring it to me — and a text approximation loses exactly
 * that.
 *
 * Drawn on a 340×160 canvas; `width` scales the whole thing.
 *
 * The default tint is the fixed brand ramp, not the section's accent. Jibli
 * Market repaints the app green, but a logo that changes colour with what the
 * customer is shopping for is not a logo — it is decoration that happens to be
 * shaped like one.
 */
/**
 * One letter of the mark, drawn on the full canvas.
 *
 * Every letter keeps the whole 340×160 viewBox and its own coordinates inside
 * it, which is what lets the animated version stack five of them and have them
 * land exactly where the single drawing puts them. No offsets to keep in sync:
 * the letter's position is in its own path data, where it already was.
 */
const LETTERS: readonly ((tint: string, pinTint: string) => React.ReactNode)[] = [
  // J — the pin is its dot
  (tint, pinTint) => (
    <G>
      <Path
        d="M 58 48 C 58 35.85 67.85 26 80 26 C 92.15 26 102 35.85 102 48 C 102 59.5 86 78 80 84 C 74 78 58 59.5 58 48 Z"
        fill={tint}
      />
      <Circle cx={80} cy={47} r={6.5} fill={pinTint} />
      <Path
        d="M 72 88 L 88 88 L 88 120 C 88 136 76 148 56 148 C 36 148 24 135 24 122 C 24 116.5 28.5 112 34 112 C 39.5 112 43 116 48 120 C 51 122.5 55 124 59 124 C 67 124 72 118 72 110 L 72 88 Z"
        fill={tint}
      />
    </G>
  ),
  // i
  (tint) => (
    <G>
      <Circle cx={118} cy={62} r={9} fill={tint} />
      <Rect x={109} y={80} width={18} height={65} rx={9} fill={tint} />
    </G>
  ),
  // b
  (tint) => (
    <G>
      <Rect x={144} y={30} width={18} height={115} rx={9} fill={tint} />
      <Path
        d="M 160 81 C 168 76 178 73 190 73 C 213 73 229 90 229 113 C 229 135 212 150 188 150 C 176 150 166 145 158 138 L 158 81 Z M 162 113 C 162 125 172 133 186 133 C 199 133 210 124 210 112 C 210 99 199 90 186 90 C 172 90 162 99 162 113 Z"
        fill={tint}
        fillRule="evenodd"
      />
    </G>
  ),
  // l
  (tint) => <Rect x={245} y={30} width={18} height={115} rx={9} fill={tint} />,
  // i
  (tint) => (
    <G>
      <Circle cx={288} cy={62} r={9} fill={tint} />
      <Rect x={279} y={80} width={18} height={65} rx={9} fill={tint} />
    </G>
  ),
];

/**
 * The letters converge into the mark.
 *
 * `Enter` fades and lifts, which is the right entrance for a section of a
 * screen and the wrong one for a logo: five identical lifts read as five
 * things arriving, not as one word assembling. This starts each letter pushed
 * outward from the centre of the word and slightly small, then draws them in.
 * The eye reads it as the mark gathering itself, which is what it is.
 *
 * Native-driven, like `Enter`, and for the same reason: it runs while the
 * session resolves and the storefront fetches, and an entrance that stutters
 * on the first screen of the app is worse than none. `react-native-svg` cannot
 * hand its props to the native driver, so the transform lives on an
 * `Animated.View` wrapping a full-canvas `Svg` — each letter keeps the whole
 * viewBox, so they register exactly where the static drawing puts them.
 *
 * Reduce motion is honoured and assumed until proven otherwise, so a phone
 * with the setting on never sees a frame of movement.
 */
function Gather({
  children,
  index,
  count,
  style,
}: {
  children: React.ReactNode;
  index: number;
  count: number;
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
      progress.setValue(1);
      return;
    }

    // Reset first, or the effect's second pass animates from 1 to 1 and
    // nothing ever moves — the bug `Enter` documents at length.
    progress.setValue(0);

    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 520,
      // Staggered from the outside in, so the word closes rather than wipes.
      delay: Math.round(Math.abs(index - (count - 1) / 2) * 60),
      /*
       * A gentle overshoot: the letters arrive, pass their mark by a hair and
       * settle, which is what makes it read as gathering rather than sliding
       * to a stop. More tension than this and the mark wobbles, which on a
       * logo looks like a mistake rather than a flourish.
       */
      easing: Easing.out(Easing.back(1.2)),
      useNativeDriver: true,
    });

    animation.start();
    return () => animation.stop();
  }, [reduceMotion, progress, index, count]);

  /*
   * Outward from the middle of the word, proportional to the distance from it:
   * the outer letters travel furthest, the middle ones barely move. That
   * gradient is what makes five separate moves read as one word closing up.
   */
  const offset = (index - (count - 1) / 2) * 26;

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [offset, 0],
              }),
            },
            {
              scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

export function JibliWordmark({
  width = 220,
  tint = palette.white,
  pinTint = BRAND[500],
  animate = false,
}: {
  width?: number;
  /** The letterforms. White on the brand ground, brand on white. */
  tint?: string;
  /** The dot inside the pin — it has to match whatever is behind the mark. */
  pinTint?: string;
  /**
   * Letter by letter, once, on mount.
   *
   * Off by default and deliberately so. The mark appears in a header on most
   * screens, where a logo that assembles itself every time is a thing to sit
   * through rather than a welcome. It is on for the screen that opens the app,
   * which nobody arrives at twice in a row.
   */
  animate?: boolean;
}) {
  const height = (width * 160) / 340;

  if (!animate) {
    return (
      <Svg width={width} height={height} viewBox="0 0 340 160" accessibilityLabel="Jibli">
        {LETTERS.map((letter, index) => (
          <G key={index}>{letter(tint, pinTint)}</G>
        ))}
      </Svg>
    );
  }

  /*
   * Five stacked drawings rather than five animated groups.
   *
   * `react-native-svg` cannot hand its props to the native driver, so animating
   * a `<G>` would run the whole entrance on the JS thread — which on this
   * screen is busy resolving a session and fetching two storefronts, and a
   * logo that stutters while it assembles is worse than one that simply
   * appears. An `Animated.View` per letter is native-driven, and because each
   * letter keeps the full viewBox they register exactly.
   *
   * 70ms apart: enough to read as a sequence, short enough that the last
   * letter lands before anybody has decided to look away.
   */
  return (
    <View style={{ width, height }} accessible accessibilityRole="image" accessibilityLabel="Jibli">
      {LETTERS.map((letter, index) => (
        <Gather key={index} index={index} count={LETTERS.length} style={StyleSheet.absoluteFill}>
          <Svg width={width} height={height} viewBox="0 0 340 160">
            {letter(tint, pinTint)}
          </Svg>
        </Gather>
      ))}
    </View>
  );
}

/**
 * The pin on its own — for a header, a tab bar, an empty state.
 */
export function JibliPin({ size = 24, tint = palette.white, pinTint = BRAND[500] }) {
  return (
    <Svg width={size} height={size} viewBox="50 18 60 74">
      <Path
        d="M 58 48 C 58 35.85 67.85 26 80 26 C 92.15 26 102 35.85 102 48 C 102 59.5 86 78 80 84 C 74 78 58 59.5 58 48 Z"
        fill={tint}
      />
      <Circle cx={80} cy={47} r={6.5} fill={pinTint} />
    </Svg>
  );
}

/**
 * The flag of Iraq.
 *
 * Drawn rather than written as 🇮🇶, because the emoji is a pair of regional
 * indicator letters and a font without the flag glyph renders them literally —
 * which is what was happening: the sign-in screen showed "IQ" beside +964.
 * Three bands and the takbir always render, on every device.
 *
 * The script is set in Cairo, which the app already loads, so it matches the
 * rest of the screen rather than falling back to whatever the system picks.
 */
export function IraqFlag({ width = 26 }: { width?: number }) {
  // The official ratio is 2:3.
  const height = (width * 2) / 3;

  return (
    <Svg width={width} height={height} viewBox="0 0 900 600" accessibilityLabel="العراق">
      <Rect x={0} y={0} width={900} height={200} fill="#ce1126" />
      <Rect x={0} y={200} width={900} height={200} fill="#ffffff" />
      <Rect x={0} y={400} width={900} height={200} fill="#000000" />
      <SvgText
        x={450}
        y={335}
        fill="#007a3d"
        fontSize={110}
        fontFamily="Cairo_700Bold"
        textAnchor="middle"
      >
        الله أكبر
      </SvgText>
    </Svg>
  );
}
