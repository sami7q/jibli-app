import { I18nManager, Platform, type TextStyle, type ViewStyle } from 'react-native';
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
 * How tall the bottom tab bar is.
 *
 * Here rather than in the tabs layout because two things need it and only one
 * of them draws it: anything floating above the bar — a live-order card, a
 * toast — has to know where the bar ends, and a second copy of the number is
 * how such a thing ends up half a centimetre out on one platform.
 *
 * The iOS figure covers the home indicator, which the bar sits over.
 */
export const TAB_BAR_HEIGHT = TAP_TARGET + (Platform.OS === 'ios' ? 34 : 14);

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

/** Every family the app must load before its first text renders. */
export const FONT_FAMILIES = Object.values(FAMILY_FOR_WEIGHT);

/**
 * Type styles, with line height resolved to absolute pixels.
 *
 * React Native's `lineHeight` is a number of pixels, not a multiplier, so the
 * ratio is applied here. Rounded, because a fractional line height makes text
 * jitter by a pixel between re-renders on Android.
 */
/**
 * A row that reads right-to-left, whatever the native flag happens to say.
 *
 * `I18nManager.forceRTL(true)` does not take effect until the app restarts,
 * and in Expo Go it may never stick at all — so `isRTL` is false on the device
 * this app is tested on and true in a store build that has been opened twice.
 * Code that writes `flexDirection: 'row'` and trusts the flag therefore renders
 * one way here and the other way there, which is exactly what happened: the
 * account screen, the search field and the phone input all laid themselves out
 * left-to-right on a phone while the screens that hard-coded `row-reverse`
 * looked correct beside them.
 *
 * Hard-coding `row-reverse` is not the fix either — it is the same bug from the
 * other side, and it breaks the moment the flag flips.
 *
 * So the direction is derived rather than assumed. `ROW` always reads
 * right-to-left and `ROW_LTR` always reads left-to-right, in both modes, and
 * nothing in the app has to know which mode it is in.
 *
 * One consequence worth stating: with visual order pinned this way, positional
 * styles must be **physical** (`left`/`right`, `marginLeft`) rather than
 * logical (`start`/`end`, `marginStart`). The logical ones flip with the flag,
 * so they would reintroduce the same split they are meant to avoid.
 */
/**
 * Whether the platform is already laying out right-to-left on its own.
 *
 * Two different mechanisms, and both have to be asked. On a device it is the
 * native flag. On the web `I18nManager` is a stub whose flag never becomes
 * true, but `enforceRtl` sets `dir="rtl"` on the document — and CSS flexbox
 * follows the writing direction, so `flex-direction: row` is already reading
 * right-to-left there. Consulting only the flag would have given the browser
 * `row-reverse` inside an RTL document, which renders left-to-right: the web
 * preview would have come out mirrored the moment the phone came out right.
 */
const laidOutRtl = I18nManager.isRTL || Platform.OS === 'web';

/**
 * Whether the platform mirrors the layout for us.
 *
 * Exported because a handful of things cannot be expressed as a style token and
 * have to branch on it directly: the order the tab bar's own row draws its
 * items in, and where a horizontal list starts scrolling from. Everything else
 * should reach for `ROW`, `ALIGN_START` or `TEXT_START` instead — a screen that
 * asks this question itself is a screen that will get it wrong.
 */
export const LAID_OUT_RTL = laidOutRtl;

export const ROW: ViewStyle['flexDirection'] = laidOutRtl ? 'row' : 'row-reverse';

/** For content that reads left-to-right inside this app: a phone number, a price. */
export const ROW_LTR: ViewStyle['flexDirection'] = laidOutRtl ? 'row-reverse' : 'row';

/**
 * The cross-axis ends of a column, pinned the same way `ROW` pins a row.
 *
 * `flex-start` in a column follows the layout direction exactly as
 * `flexDirection: 'row'` does, so a badge or a button that says `alignSelf:
 * 'flex-start'` lands against the left edge on a device where the native flag
 * never took — under a heading that is already sitting on the right. These two
 * always mean the right and the left edge respectively, in both modes.
 *
 * **Only inside a column.** The cross axis of a *row* is vertical and does not
 * mirror, so `alignSelf: ALIGN_START` on a child of a `Row` does not say "the
 * right edge" — it says "the bottom". A pill or a button in a row wants
 * `flex-start` or `center`, spelled physically, and means the ordinary thing.
 */
export const ALIGN_START: ViewStyle['alignItems'] = laidOutRtl ? 'flex-start' : 'flex-end';
export const ALIGN_END: ViewStyle['alignItems'] = laidOutRtl ? 'flex-end' : 'flex-start';

/**
 * Where a line of Arabic begins.
 *
 * Physical on purpose. `textAlign: 'auto'` resolves from the first strong
 * character in the string, which is right for a sentence of Arabic and wrong
 * for every line that opens with a price, an order number or a Latin brand —
 * those slide to the left edge in the middle of a right-aligned column.
 */
export const TEXT_START: TextStyle['textAlign'] = 'right';

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
 * Force RTL at startup.
 *
 * Release 1 is Arabic-only, so the layout direction is a product decision, not
 * something to inherit from the device locale — a phone set to English must
 * still render Jibli right-to-left (plan §2).
 *
 * Must run before the first render. On a fresh install `forceRTL` only takes
 * effect after a restart, which is why `isRtlActive()` exists: the first launch
 * can be laid out the wrong way round, and a screen that needs to know can ask.
 */
export function enforceRtl(): void {
  if (!I18nManager.isRTL) {
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(true);
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

/** True once the native layer is actually laying out RTL. */
export function isRtlActive(): boolean {
  return I18nManager.isRTL;
}
