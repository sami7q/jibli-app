import { I18nManager, Platform, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  color as tokenColor,
  duration,
  fontSize,
  fontWeight,
  lineHeight,
  palette,
  radius,
  shadow as shadowTokens,
  shadowColor,
  space,
  tapTarget,
  type ShadowToken,
} from '@jibli/design-tokens';
import type { MerchantType } from '@jibli/contracts';

/**
 * The mobile theme.
 *
 * An adapter, not a source. Every value comes from `@jibli/design-tokens`,
 * which the web portals read too — this file's whole job is turning
 * platform-neutral data into React Native shapes: a shadow into
 * `shadowOffset`/`elevation`, a multiplier into an absolute `lineHeight`.
 *
 * It used to be a hand-typed copy of the web palette. That is the kind of
 * duplication nobody notices until a designer changes the orange, one copy is
 * updated, and the phone quietly stops matching the portals.
 */

export { palette, radius, space, fontSize, fontWeight, duration };

// ── The accent ─────────────────────────────────────────────────────

/**
 * Jibli Market is the same app in green.
 *
 * Not a second design: the same cards, the same badges, the same buttons, one
 * ramp swapped for another that has the same ten stops. That is the whole
 * mechanism, and it is why a screen written for food is already correct for
 * the market — nothing in a screen says «orange», it says `color.brand`.
 *
 * Swapped rather than passed down. A theme in context would mean every screen
 * that draws anything reads a hook and re-renders through it, and the app has
 * a hundred and eleven of those references across twenty-four files — the
 * refactor would be larger than the feature and every new screen would have to
 * remember to use it. A module-level ramp read through getters puts the
 * decision in one place and leaves the screens alone.
 *
 * What makes that safe is where it is set: `VerticalProvider` assigns it while
 * rendering, above every screen, so the pass that paints a green home screen
 * is the same pass that made the ramp green. There is no frame in between.
 */
type Ramp = Readonly<Record<keyof typeof palette.orange, string>>;

const RAMP_FOR_SECTION: Readonly<Record<MerchantType, Ramp>> = {
  RESTAURANT: palette.orange,
  MARKET: palette.green,
  COSMETICS: palette.rose,
};

/** Orange until told otherwise — it is the brand, and the chooser is orange-led. */
let ramp: Ramp = palette.orange;
let section: MerchantType | null = null;

/**
 * Point the accent at a section's ramp.
 *
 * `null` — nobody has chosen — is the brand orange, which is what the sign-in
 * flow, the chooser's header and the wordmark are drawn in.
 *
 * Idempotent, and cheap enough to call on every render of the provider.
 */
export function setAccentSection(next: MerchantType | null): void {
  section = next;
  ramp = next ? RAMP_FOR_SECTION[next] : palette.orange;
}

/**
 * Which half the app is currently drawn for.
 *
 * For the few things a colour cannot carry — the glyph standing in for a
 * missing picture is a fork in a restaurant and a basket in a market. Read
 * from here rather than from `useVertical` so that a leaf component drawing a
 * placeholder does not need to be inside the provider to render at all; the
 * provider sets this above them, and a render that changes it re-renders them.
 */
export const currentSection = (): MerchantType | null => section;

/**
 * The brand's own ramp, which never shifts.
 *
 * For the screens that are not in a section: signing in, the driver's shift,
 * the wordmark itself. Jibli is orange — a customer who taps «تسجيل الدخول»
 * from the market has not left the market, and the sign-in screen is not a
 * grocery screen; it belongs to the company rather than to either half.
 *
 * It also fixes a real hazard. Those screens build their styles with
 * `StyleSheet.create` at module scope, which reads its colours exactly once —
 * when the module first loads. Pointed at the shifting accent, the sign-in
 * screen would keep whichever colour the app happened to be wearing the first
 * time anybody opened it, forever, including back in the other section.
 * Reading the fixed ramp makes that impossible rather than unlikely.
 */
export const BRAND = palette.orange;

/**
 * The current ramp, stop by stop.
 *
 * For the handful of places that need a shade the semantic names do not cover
 * — a 200 hairline, a 300 empty-state glyph. Reaching for `palette.orange[300]`
 * in a screen is what makes a screen untintable, which is the bug this exists
 * to prevent.
 */
export const accent: Ramp = {
  get 50() {
    return ramp[50];
  },
  get 100() {
    return ramp[100];
  },
  get 200() {
    return ramp[200];
  },
  get 300() {
    return ramp[300];
  },
  get 400() {
    return ramp[400];
  },
  get 500() {
    return ramp[500];
  },
  get 600() {
    return ramp[600];
  },
  get 700() {
    return ramp[700];
  },
  get 800() {
    return ramp[800];
  },
  get 900() {
    return ramp[900];
  },
};

/**
 * The semantic colours, with the brand family following the current section.
 *
 * Everything else passes through from the tokens unchanged — ink, surfaces,
 * borders and the status colours mean the same thing in both halves, and a
 * danger red that shifted with the section would stop being a danger red.
 */
export const color = {
  ...tokenColor,
  get brand() {
    return ramp[500];
  },
  get brandStrong() {
    return ramp[600];
  },
  get brandDeep() {
    return ramp[700];
  },
  get brandSoft() {
    return ramp[50];
  },
  get textBrand() {
    return ramp[600];
  },
};

/** Minimum touch target on a phone (plan §134). */
export const TAP_TARGET = tapTarget.native;

/**
 * The tab bar's own height, before the system's inset is added to it.
 *
 * Here rather than in the tabs layout because two things need it and only one
 * of them draws it: anything floating above the bar — a live-order card, a
 * toast — has to know where the bar ends, and a second copy of the number is
 * how such a thing ends up half a centimetre out on one platform.
 *
 * It used to be this plus a constant for the area below: 34 on iOS for the home
 * indicator, and 14 on Android. The iOS number is right because the home
 * indicator is always the same height. The Android one was a guess, and wrong
 * for the common case — three-button navigation reserves roughly 48 — which put
 * the tab icons underneath the system bar. Under API 36 that is no longer even
 * a device-specific problem: Android 15 enforces edge-to-edge and removes the
 * opt-out, so the system bar overlaps by default everywhere.
 *
 * So the constant is now only the part that *is* constant, and every consumer
 * adds `useSafeAreaInsets().bottom` — the measured value, on both platforms —
 * via `useTabBarHeight()` below.
 *
 * The number is what the bar actually stacks, top to bottom: its own top
 * padding (4), the navigator's item padding (5, not overridable), the icon's
 * box (28 — see the tabs layout), the label's line (a caption, 19), the item
 * padding again (5), and one point of slack. It was `TAP_TARGET + space[1]`,
 * 52, which is nine short of that: the column overflowed the bar and the
 * label sat wherever the overflow left it.
 */
export const TAB_BAR_CONTENT_HEIGHT = 62;

/**
 * One bundled font file per weight, named by the family React Native will ask
 * for.
 *
 * This is the detail that decides whether the app looks right on Android.
 * Android does not synthesise weights for a custom font: `fontFamily: 'Cairo'`
 * with `fontWeight: '700'` renders *regular*, silently, while the same code on
 * iOS looks bold — so a heading is heavy on one platform and not the other and
 * nobody can see why from the code.
 *
 * Naming the family per weight and never setting `fontWeight` makes both
 * platforms load the file that was actually designed at that weight.
 */
const FAMILY_FOR_WEIGHT: Record<string, string> = {
  [fontWeight.regular]: 'Cairo_400Regular',
  [fontWeight.medium]: 'Cairo_500Medium',
  [fontWeight.semibold]: 'Cairo_600SemiBold',
  [fontWeight.bold]: 'Cairo_700Bold',
  [fontWeight.extrabold]: 'Cairo_800ExtraBold',
};

/**
 * Type styles, with line height resolved to absolute pixels.
 *
 * React Native's `lineHeight` is a number of pixels, not a multiplier, so the
 * ratio is applied here. Rounded, because a fractional line height makes text
 * jitter by a pixel between re-renders on Android.
 */
/**
 * A row that reads right-to-left, whichever way the native layer is drawing.
 *
 * The app is Arabic-only, so every row reads right-to-left — but whether the
 * platform mirrors `flexDirection: 'row'` for us is not one fact, it is three:
 *
 *   - **Not at all.** A fresh install before `forceRTL` has taken, Expo Go
 *     until it restarts, a browser with no `dir`. `'row'` draws left-to-right.
 *   - **Yes.** A build with the localization plugin, any build opened a second
 *     time, the web once `enforceRtl` has set `dir="rtl"`. `'row'` draws
 *     right-to-left.
 *   - **The flag says yes and the layout says no.** Seen in Expo Go on an
 *     Android emulator on 2026-09-30: `I18nManager.isRTL` read `true` and not
 *     one row was mirrored. Code that trusted the flag drew the whole app
 *     left-to-right — headers, the account rows, the tab bar — while the same
 *     code on a phone in the second state was right.
 *
 * So the direction is neither read off the flag nor hard-coded. It is
 * measured: before the first screen renders, `DirectionProbe` lays out one
 * hidden row and reports which side its first child landed on, and
 * `applyLayoutDirection` sets the tokens below from that answer. `ROW` then
 * always reads right-to-left and `ROW_LTR` always left-to-right, and nothing
 * else in the app has to know which of the three states it is in.
 *
 * One consequence worth stating: with visual order pinned this way, positional
 * styles must be **physical** (`left`/`right`, `marginLeft`) rather than
 * logical (`start`/`end`, `marginStart`). The logical ones flip with the native
 * direction, so they would reintroduce the split. `enforceRtl` also switches
 * off React Native's default of reading `left`/`right` as `start`/`end` once it
 * is mirroring, so a physical side is physical in every state.
 */

/**
 * Whether the platform mirrors the layout for us.
 *
 * `let`, and set by `applyLayoutDirection` — see above. The initial value is
 * only the best guess before the probe answers: the flag on a device, and true
 * on the web, where CSS follows the document's `dir`. Nothing renders on the
 * guess; the root holds the app until the measurement is in.
 *
 * Exported because a handful of things cannot be expressed as a style token and
 * have to branch on it directly: the order the tab bar's own row draws its
 * items in, and where a horizontal list starts scrolling from. Everything else
 * should reach for `ROW`, `ALIGN_START` or `TEXT_START` instead — a screen that
 * asks this question itself is a screen that will get it wrong.
 */
export let LAID_OUT_RTL: boolean = Platform.OS === 'web' || I18nManager.isRTL;

export let ROW: ViewStyle['flexDirection'] = rowFor(LAID_OUT_RTL);

/** For content that reads left-to-right inside this app: a phone number, a price. */
export let ROW_LTR: ViewStyle['flexDirection'] = rowLtrFor(LAID_OUT_RTL);

/**
 * The cross-axis ends of a column, pinned the same way `ROW` pins a row.
 *
 * `flex-start` in a column follows the layout direction exactly as
 * `flexDirection: 'row'` does, so a badge or a button that says `alignSelf:
 * 'flex-start'` lands against the left edge on a device where the native flag
 * never took — under a heading that is already sitting on the right. These two
 * always mean the right and the left edge respectively, in every state.
 *
 * **Only inside a column.** The cross axis of a *row* is vertical and does not
 * mirror, so `alignSelf: ALIGN_START` on a child of a `Row` does not say "the
 * right edge" — it says "the bottom". A pill or a button in a row wants
 * `flex-start` or `center`, spelled physically, and means the ordinary thing.
 */
export let ALIGN_START: ViewStyle['alignItems'] = alignStartFor(LAID_OUT_RTL);
export let ALIGN_END: ViewStyle['alignItems'] = alignEndFor(LAID_OUT_RTL);

function rowFor(mirrored: boolean): ViewStyle['flexDirection'] {
  return mirrored ? 'row' : 'row-reverse';
}

function rowLtrFor(mirrored: boolean): ViewStyle['flexDirection'] {
  return mirrored ? 'row-reverse' : 'row';
}

function alignStartFor(mirrored: boolean): ViewStyle['alignItems'] {
  return mirrored ? 'flex-start' : 'flex-end';
}

function alignEndFor(mirrored: boolean): ViewStyle['alignItems'] {
  return mirrored ? 'flex-end' : 'flex-start';
}

/**
 * Tell the tokens which way the native layer actually lays out.
 *
 * Called once, by `DirectionProbe`, from the root and before any screen has
 * rendered. Every reader of `ROW` and its siblings reads them at render time
 * through the module's live binding, so the change needs no re-render to take
 * — and no file captures one of them at module scope, which is what would
 * freeze the guess. `direction.test.ts` keeps both of those true.
 */
export function applyLayoutDirection(mirrored: boolean): void {
  LAID_OUT_RTL = mirrored;
  ROW = rowFor(mirrored);
  ROW_LTR = rowLtrFor(mirrored);
  ALIGN_START = alignStartFor(mirrored);
  ALIGN_END = alignEndFor(mirrored);
  TEXT_START = textStartFor(mirrored);
}

/**
 * A stylesheet built on first use rather than when the module loads.
 *
 * `StyleSheet.create` at module scope runs while the app is still being
 * imported — before the probe has measured anything — so a `flexDirection:
 * ROW` inside one would keep the pre-measurement guess for the life of the
 * process, and the six screens that keep their styles in a sheet would lay
 * themselves out from a different answer than every screen that styles
 * inline. Wrapped in this, the sheet is built the first time a style is read,
 * which is inside a render and therefore after the root has measured. Reads
 * look exactly as before: `styles.row`.
 */
export function lazySheet<T extends object>(build: () => T): T {
  let sheet: T | null = null;
  return new Proxy({} as T, {
    get(_target, key) {
      if (sheet === null) sheet = build();
      return sheet[key as keyof T];
    },
  });
}

/**
 * Where a line of Arabic begins, for `Text`: the right edge.
 *
 * Never `'auto'`: that resolves from the first strong character in the string,
 * which is right for a sentence of Arabic and wrong for every line that opens
 * with a price, an order number or a Latin brand — those slide to the left
 * edge in the middle of a right-aligned column.
 *
 * And not always `'right'`, which is the part that was wrong. On Android a
 * `Text`'s alignment goes through `TextLayoutManager`, which reads `'right'`
 * against the paragraph direction: while the native layer is laying out
 * left-to-right, `'right'` is the right edge; once it mirrors — a store build
 * after `forceRTL` has taken, Expo Go after a restart — `'right'` resolves to
 * `ALIGN_OPPOSITE` and lands on the *left*. Every heading in the app sat on
 * the wrong edge in exactly the builds customers get. iOS and the web treat
 * the word physically. So, like `ROW`, this follows the measured direction:
 * `applyLayoutDirection` gives Android the word that its own flip turns into
 * the right edge.
 *
 * For a `TextInput` use `INPUT_TEXT_START` instead — that one *is* physical
 * on every platform, and giving it this token would flip it the wrong way.
 */
export let TEXT_START: TextStyle['textAlign'] = textStartFor(LAID_OUT_RTL);

/**
 * Where typed Arabic begins, for `TextInput`: the right edge, physically.
 *
 * Android sets an input's gravity from the word as written — `Gravity.RIGHT`
 * for `'right'` — with no paragraph-direction flip, so a constant is correct
 * in every state.
 */
export const INPUT_TEXT_START: TextStyle['textAlign'] = 'right';

function textStartFor(mirrored: boolean): TextStyle['textAlign'] {
  return Platform.OS === 'android' && mirrored ? 'left' : 'right';
}

function type(size: number, weight: keyof typeof FAMILY_FOR_WEIGHT, ratio: number): TextStyle {
  return {
    fontFamily: FAMILY_FOR_WEIGHT[weight],
    fontSize: size,
    lineHeight: Math.round(size * ratio),
  };
}

export const text = {
  display: type(fontSize['3xl'], fontWeight.extrabold, lineHeight.tight),
  h1: type(fontSize['2xl'], fontWeight.extrabold, lineHeight.tight),
  h2: type(fontSize.xl, fontWeight.bold, lineHeight.tight),
  h3: type(fontSize.lg, fontWeight.bold, lineHeight.normal),
  body: type(fontSize.base, fontWeight.regular, lineHeight.normal),
  bodyBold: type(fontSize.base, fontWeight.bold, lineHeight.normal),
  small: type(fontSize.sm, fontWeight.regular, lineHeight.normal),
  smallBold: type(fontSize.sm, fontWeight.semibold, lineHeight.normal),
  caption: type(fontSize.xs, fontWeight.medium, lineHeight.normal),
  /*
   * The same size as `caption`, heavier.
   *
   * Emphasis at this size has to come from weight alone: stepping up to
   * `smallBold` changes the size too, and a label that grows when selected
   * reflows the row under the finger that selected it.
   */
  captionBold: type(fontSize.xs, fontWeight.bold, lineHeight.normal),
} as const;

/**
 * A shadow as React Native understands it.
 *
 * iOS composites a real shadow from offset/radius/opacity; Android has only an
 * `elevation` integer and draws its own. Neither can be expressed as the
 * other, which is why the token carries both rather than a CSS string.
 */
function elevate(token: ShadowToken): ViewStyle {
  return (
    Platform.select<ViewStyle>({
      ios: {
        shadowColor,
        shadowOffset: { width: 0, height: token.offsetY },
        shadowOpacity: token.opacity,
        // CSS blur is a diameter; iOS `shadowRadius` is closer to a radius.
        shadowRadius: token.blur / 2,
      },
      android: { elevation: token.elevation },
      default: {},
    }) ?? {}
  );
}

export const shadow = {
  sm: elevate(shadowTokens.sm),
  md: elevate(shadowTokens.md),
  lg: elevate(shadowTokens.lg),
  xl: elevate(shadowTokens.xl),
} as const;

/**
 * Force RTL at startup, and make a physical side stay physical.
 *
 * Release 1 is Arabic-only, so the layout direction is a product decision, not
 * something to inherit from the device locale — a phone set to English must
 * still render Jibli right-to-left (plan §2).
 *
 * Must run before the first render. Two native switches, both persisted by
 * React Native:
 *
 *   `forceRTL(true)` asks the native layer to mirror rows. It only takes on the
 *   next launch, which is why the localization plugin also sets it at build
 *   time — and why nothing in the app depends on it having taken:
 *   `DirectionProbe` measures the outcome and the layout tokens follow the
 *   measurement, whatever it is.
 *
 *   `swapLeftAndRightInRTL(false)` stops React Native reading `left`, `right`,
 *   `marginLeft`, `paddingRight` and the rest as `start`/`end` once it is
 *   mirroring — which it does by default, on both platforms, and which moved
 *   every badge the app pins to the right over to the left the moment a
 *   build's RTL took. The whole app writes physical sides on purpose; this
 *   makes the platform honour them in every state.
 */
export function enforceRtl(): void {
  if (Platform.OS !== 'web') {
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(true);
    I18nManager.swapLeftAndRightInRTL(false);
  }

  /*
   * The browser needs telling separately.
   *
   * React Native Web's I18nManager is a stub: `forceRTL` sets a flag nothing
   * reads, so `expo start --web` lays the app out left-to-right while every
   * device lays it out right-to-left. That makes the web preview actively
   * misleading — headers mirrored, chevrons pointing the wrong way — which is
   * worse than not having one.
   *
   * Setting `dir` on the document is what CSS actually reads: it reverses
   * every `flex-direction: row`, which is the same thing the native layout
   * does. One line, and the preview tells the truth.
   */
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.documentElement.setAttribute('dir', 'rtl');
    document.documentElement.setAttribute('lang', 'ar');
  }
}

/**
 * How much room the tab bar takes at the bottom of the screen, for this device.
 *
 * The one number anything floating above the bar should use. Kept beside the
 * bar's own constant so the card that hovers over it and the bar itself cannot
 * drift apart — which is what happened when each added its own guess at the
 * system inset.
 */
export function useTabBarHeight(): number {
  return TAB_BAR_CONTENT_HEIGHT + useSafeAreaInsets().bottom;
}
