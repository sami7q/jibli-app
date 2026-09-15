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
/**
 * The strokes of the mark, left to right, without the pin.
 *
 * Every stroke keeps the whole 340×160 viewBox and its own coordinates inside
 * it, which is what lets the animated version stack them and have each land
 * exactly where the single drawing puts it. No offsets to keep in sync: the
 * letter's position is in its own path data, where it already was.
 *
 * The pin is not among them. It is drawn separately below, because in the
 * animation it is not a letter — it is the last thing to arrive.
 */
const STROKES: readonly ((tint: string) => React.ReactNode)[] = [
  // J — the hook, without its dot
  (tint) => (
    <Path
      d="M 72 88 L 88 88 L 88 120 C 88 136 76 148 56 148 C 36 148 24 135 24 122 C 24 116.5 28.5 112 34 112 C 39.5 112 43 116 48 120 C 51 122.5 55 124 59 124 C 67 124 72 118 72 110 L 72 88 Z"
      fill={tint}
    />
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
 * The pin — the J's dot, and the whole idea of the mark.
 *
 * «جيبلي» is "bring it to me", and the thing that makes the wordmark mean that
 * rather than just spell it is that the J is dotted with a map pin. In the
 * animation it is therefore not a letter among five: it is the arrival. The
 * strokes assemble, and then the pin drops onto the word and settles.
 */
const PIN = (tint: string, pinTint: string) => (
  <G>
    <Path
      d="M 58 48 C 58 35.85 67.85 26 80 26 C 92.15 26 102 35.85 102 48 C 102 59.5 86 78 80 84 C 74 78 58 59.5 58 48 Z"
      fill={tint}
    />
    <Circle cx={80} cy={47} r={6.5} fill={pinTint} />
  </G>
);

/**
 * Whether the phone has asked for less movement.
 *
 * Assumed true until the async check says otherwise: `isReduceMotionEnabled`
 * resolves a tick late, and defaulting to "motion allowed" would start every
 * animation and cancel it a frame later — precisely the flash the setting
 * exists to prevent.
 */
function useReduceMotion(): boolean {
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

  return reduceMotion;
}

/**
 * Drives one value from 0 to 1, once, respecting reduce motion.
 *
 * The reset before starting is load-bearing and was a real bug once: the
 * initial state is «reduced until proven otherwise», so the first pass always
 * sets the value to 1. When the async check comes back saying motion is
 * allowed, the effect re-runs — and animating to 1 from 1 is a no-op. Every
 * entrance in the app was silently arriving finished.
 */
function useEntrance(config: {
  delay: number;
  duration: number;
  easing: (value: number) => number;
}): Animated.Value {
  const progress = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();
  const { delay, duration, easing } = config;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay,
      easing,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [reduceMotion, progress, delay, duration, easing]);

  return progress;
}

/** One stroke of the mark arriving: up a little, into focus. */
function Rise({
  children,
  delay,
  style,
}: {
  children: React.ReactNode;
  delay: number;
  style?: React.ComponentProps<typeof Animated.View>['style'];
}) {
  const progress = useEntrance({ delay, duration: 300, easing: Easing.out(Easing.cubic) });

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * The pin, falling onto the word.
 *
 * It comes from well above the mark and overshoots slightly on landing, which
 * is what makes it read as dropped rather than faded in. `Easing.bounce` is
 * too much — a logo that bounces twice looks like a mistake — so this is a
 * single soft overshoot.
 */
function Drop({
  children,
  delay,
  style,
}: {
  children: React.ReactNode;
  delay: number;
  style?: React.ComponentProps<typeof Animated.View>['style'];
}) {
  const progress = useEntrance({ delay, duration: 460, easing: Easing.out(Easing.back(2.2)) });

  return (
    <Animated.View
      style={[
        style,
        {
          // Opaque early in the fall, so it is a pin dropping rather than a
          // shape fading in while it happens to move.
          opacity: progress.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 1, 1] }),
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-44, 0] }) },
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
        {STROKES.map((stroke, index) => (
          <G key={index}>{stroke(tint)}</G>
        ))}
        {PIN(tint, pinTint)}
      </Svg>
    );
  }

  /*
   * The mark writes itself, and then the pin lands on it.
   *
   * The strokes arrive in reading order — J, i, b, l, i — each rising a few
   * pixels into place, 90ms apart. That is the part that reads as writing: a
   * word appearing the way a word is written, rather than five things fading
   * in at once. Then the pin drops from above onto the J and settles with a
   * small bounce, which is the only flourish and the one worth having: the
   * pin *is* the mark's idea, so the entrance ends on the thing the logo is
   * about rather than on a generic sweep.
   *
   * Stacked drawings rather than animated `<G>` elements. `react-native-svg`
   * cannot hand its props to the native driver, so animating a group would run
   * the whole entrance on the JS thread — which on this screen is busy
   * resolving a session and fetching a storefront, and a logo that stutters
   * while it assembles is worse than one that simply appears. An
   * `Animated.View` per stroke is native-driven, and because each stroke keeps
   * the full viewBox they register exactly.
   */
  return (
    <View style={{ width, height }} accessible accessibilityRole="image" accessibilityLabel="Jibli">
      {STROKES.map((stroke, index) => (
        <Rise key={index} delay={index * STROKE_STEP} style={StyleSheet.absoluteFill}>
          <Svg width={width} height={height} viewBox="0 0 340 160">
            {stroke(tint)}
          </Svg>
        </Rise>
      ))}

      <Drop delay={STROKES.length * STROKE_STEP + 90} style={StyleSheet.absoluteFill}>
        <Svg width={width} height={height} viewBox="0 0 340 160">
          {PIN(tint, pinTint)}
        </Svg>
      </Drop>
    </View>
  );
}

/** How far apart the strokes land. Long enough to read as a sequence. */
const STROKE_STEP = 90;

/**
 * How long the whole entrance takes, so a screen can wait for it.
 *
 * Exported because the welcome screen brings its tagline and buttons in after
 * the mark has finished — «until it completes, then enter» — and a screen
 * timing that by a number copied from here would drift the first time this
 * changes.
 */
export const WORDMARK_ENTRANCE_MS = STROKES.length * STROKE_STEP + 90 + 460;


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
