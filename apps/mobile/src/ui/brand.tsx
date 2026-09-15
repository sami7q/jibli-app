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
 * The mark, in the eight pieces the entrance moves independently.
 *
 * Each piece keeps the whole 340×160 viewBox and its own coordinates inside it,
 * which is what lets the animated version stack them and have each land exactly
 * where the single drawing puts it. No offsets to keep in sync: a piece's
 * position is in its own path data, where it already was.
 *
 * The i's are split from their dots and the J from its pin because the
 * entrance treats them differently — the strokes fly in from the sides, the
 * dots and the pin fall from above. `order` is the wordmark's reading order,
 * which is also the order they arrive in.
 */
const PARTS: readonly { key: PartKey; draw: (tint: string, pinTint: string) => React.ReactNode }[] =
  [
    // J — the hook, without its dot
    {
      key: 'j',
      draw: (tint) => (
        <Path
          d="M 72 88 L 88 88 L 88 120 C 88 136 76 148 56 148 C 36 148 24 135 24 122 C 24 116.5 28.5 112 34 112 C 39.5 112 43 116 48 120 C 51 122.5 55 124 59 124 C 67 124 72 118 72 110 L 72 88 Z"
          fill={tint}
        />
      ),
    },
    { key: 'i1', draw: (tint) => <Rect x={109} y={80} width={18} height={65} rx={9} fill={tint} /> },
    { key: 'i1dot', draw: (tint) => <Circle cx={118} cy={62} r={9} fill={tint} /> },
    {
      key: 'b',
      draw: (tint) => (
        <G>
          <Rect x={144} y={30} width={18} height={115} rx={9} fill={tint} />
          <Path
            d="M 160 81 C 168 76 178 73 190 73 C 213 73 229 90 229 113 C 229 135 212 150 188 150 C 176 150 166 145 158 138 L 158 81 Z M 162 113 C 162 125 172 133 186 133 C 199 133 210 124 210 112 C 210 99 199 90 186 90 C 172 90 162 99 162 113 Z"
            fill={tint}
            fillRule="evenodd"
          />
        </G>
      ),
    },
    { key: 'l', draw: (tint) => <Rect x={245} y={30} width={18} height={115} rx={9} fill={tint} /> },
    { key: 'i2', draw: (tint) => <Rect x={279} y={80} width={18} height={65} rx={9} fill={tint} /> },
    { key: 'i2dot', draw: (tint) => <Circle cx={288} cy={62} r={9} fill={tint} /> },
    {
      // The pin — the J's dot, and the whole idea of the mark. «جيبلي» is
      // "bring it to me", and what makes the wordmark mean that rather than
      // merely spell it is that the J is dotted with a map pin. It arrives last.
      key: 'pin',
      draw: (tint, pinTint) => (
        <G>
          <Path
            d="M 58 48 C 58 35.85 67.85 26 80 26 C 92.15 26 102 35.85 102 48 C 102 59.5 86 78 80 84 C 74 78 58 59.5 58 48 Z"
            fill={tint}
          />
          <Circle cx={80} cy={47} r={6.5} fill={pinTint} />
        </G>
      ),
    },
  ];

type PartKey = 'j' | 'i1' | 'i1dot' | 'b' | 'l' | 'i2' | 'i2dot' | 'pin';

/**
 * Where each piece starts, and when it sets off.
 *
 * Transcribed from the motion study rather than invented here, so the app and
 * the design agree frame for frame. `dx`/`dy` are fractions of the mark's own
 * width, not pixels — the study was drawn at one size and this renders at
 * several, and a pixel offset would make the J fly in from off-screen on a
 * phone and from the middle of the logo on a tablet.
 *
 * The shape of it: the five strokes glide in from far out to the left and
 * right and settle into the word; then both i-dots drop onto their stems; then
 * the pin falls from higher still and lands on the J. Nothing overlaps by
 * accident — the dots begin only once the strokes have nearly stopped, so the
 * eye reads three separate events rather than one blur.
 */
interface Flight {
  readonly dx: number;
  readonly dy: number;
  readonly rotate: number;
  readonly scale: number;
  readonly delay: number;
  readonly duration: number;
  readonly ease: 'glide' | 'spring';
}

const FLIGHT: Record<PartKey, Flight> = {
  j: { dx: -1.372, dy: 0.058, rotate: -7, scale: 0.92, delay: 0, duration: 1050, ease: 'glide' },
  i1: { dx: -1.04, dy: 0.031, rotate: -5, scale: 0.92, delay: 100, duration: 1020, ease: 'glide' },
  b: { dx: 1.195, dy: -0.04, rotate: 6, scale: 0.92, delay: 50, duration: 1050, ease: 'glide' },
  l: { dx: 1.549, dy: -0.022, rotate: 5, scale: 0.92, delay: 150, duration: 1020, ease: 'glide' },
  i2: { dx: 1.726, dy: -0.013, rotate: 4, scale: 0.92, delay: 200, duration: 1000, ease: 'glide' },
  i1dot: { dx: 0, dy: -0.73, rotate: 0, scale: 0.8, delay: 620, duration: 700, ease: 'spring' },
  i2dot: { dx: 0, dy: -0.73, rotate: 0, scale: 0.8, delay: 700, duration: 700, ease: 'spring' },
  pin: { dx: 0, dy: -1.239, rotate: 0, scale: 0.68, delay: 840, duration: 860, ease: 'spring' },
};

/** The study's two curves, by name, so the numbers stay legible. */
const EASING = {
  glide: Easing.bezier(0.16, 1, 0.3, 1),
  spring: Easing.bezier(0.34, 1.5, 0.5, 1),
} as const;

/** When the last piece has landed. Everything after the mark waits for this. */
const MARK_SETTLED_MS = Math.max(
  ...Object.values(FLIGHT).map((flight) => flight.delay + flight.duration),
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

/**
 * One piece of the mark, flying to its place.
 *
 * Native-driven, and that is not a detail: this runs while the session
 * resolves and the storefront fetches, and eight pieces animating on the JS
 * thread would stutter on exactly the screen that forms the first impression.
 * `react-native-svg` cannot hand its own props to the native driver, so the
 * transform lives on an `Animated.View` wrapping a full-canvas `Svg`.
 */
function Fly({
  children,
  flight,
  width,
  style,
}: {
  children: React.ReactNode;
  flight: Flight;
  /** The mark's rendered width — what `dx`/`dy` are fractions of. */
  width: number;
  style?: React.ComponentProps<typeof Animated.View>['style'];
}) {
  const progress = useEntrance({
    delay: flight.delay,
    duration: flight.duration,
    easing: EASING[flight.ease],
  });

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [flight.dx * width, 0],
              }),
            },
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [flight.dy * width, 0],
              }),
            },
            {
              rotate: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [`${flight.rotate}deg`, '0deg'],
              }),
            },
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [flight.scale, 1],
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

/**
 * The light behind the mark as it closes.
 *
 * It expands and fades once, timed to finish as the pin lands, so the word
 * arrives with a breath of light behind it rather than against flat colour.
 * The one purely decorative element here, and it earns its place by being over
 * in under a second and never repeating.
 */
function Glow({ size, delay }: { size: number; delay: number }) {
  const progress = useEntrance({ delay, duration: 1150, easing: Easing.out(Easing.quad) });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: 'rgba(255,255,255,0.14)',
        opacity: progress.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0.9, 0] }),
        transform: [
          { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.6] }) },
        ],
      }}
    />
  );
}

/**
 * The mark breathing, once it has settled.
 *
 * A slow seven-pixel rise and fall, forever. It is what keeps the screen from
 * looking frozen while the session resolves behind it — the difference between
 * "waiting" and "stuck" is whether anything on screen is alive.
 */
function Float({
  children,
  delay,
  enabled,
}: {
  children: React.ReactNode;
  delay: number;
  enabled: boolean;
}) {
  const drift = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (!enabled || reduceMotion) {
      drift.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 2300,
          delay,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 2300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [drift, delay, enabled, reduceMotion]);

  return (
    <Animated.View
      style={{
        transform: [
          { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }) },
        ],
      }}
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
  idle = true,
}: {
  width?: number;
  /** The letterforms. White on the brand ground, brand on white. */
  tint?: string;
  /** The dot inside the pin — it has to match whatever is behind the mark. */
  pinTint?: string;
  /**
   * Assemble on mount, piece by piece.
   *
   * Off by default and deliberately so. The mark appears in a header on most
   * screens, where a logo that assembles itself every time is a thing to sit
   * through rather than a welcome. It is on for the screen that opens the app,
   * which nobody arrives at twice in a row.
   */
  animate?: boolean;
  /** Keep the settled mark breathing. Only meaningful with `animate`. */
  idle?: boolean;
}) {
  const height = (width * 160) / 340;

  if (!animate) {
    return (
      <Svg width={width} height={height} viewBox="0 0 340 160" accessibilityLabel="Jibli">
        {PARTS.map((part) => (
          <G key={part.key}>{part.draw(tint, pinTint)}</G>
        ))}
      </Svg>
    );
  }

  /*
   * The word gathers itself, then the pin lands on it.
   *
   * Five strokes glide in from far off to either side and settle into place;
   * the two i-dots drop onto their stems; the pin falls from higher still and
   * lands on the J with a single soft overshoot. Then the whole mark breathes.
   *
   * Timings and offsets are the study's, in `FLIGHT` above, so this and the
   * design move identically. The one thing not carried across is the motion
   * blur on the incoming strokes — React Native has no per-element blur
   * without a native library, and the entrance reads correctly without it.
   */
  return (
    <Float delay={MARK_SETTLED_MS + 500} enabled={idle}>
      <View
        style={{ width, height, alignItems: 'center', justifyContent: 'center' }}
        accessible
        accessibilityRole="image"
        accessibilityLabel="Jibli"
      >
        <Glow size={width * 1.5} delay={MARK_SETTLED_MS - 280} />

        {PARTS.map((part) => (
          <Fly
            key={part.key}
            flight={FLIGHT[part.key]}
            width={width}
            style={StyleSheet.absoluteFill}
          >
            <Svg width={width} height={height} viewBox="0 0 340 160">
              {part.draw(tint, pinTint)}
            </Svg>
          </Fly>
        ))}
      </View>
    </Float>
  );
}

/**
 * How long the entrance takes, so a screen can wait it out.
 *
 * Exported because the welcome screen brings its tagline and buttons in after
 * the mark has finished — the word completes, and only then is there something
 * to press. A screen timing that by a number copied from here would drift the
 * first time this changes.
 */
export const WORDMARK_ENTRANCE_MS = MARK_SETTLED_MS;



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
