import { I18nManager, Platform, type TextStyle, type ViewStyle } from 'react-native';
import {
  color,
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

export { color, palette, radius, space, fontSize, fontWeight, duration };

/** Minimum touch target on a phone (plan §134). */
export const TAP_TARGET = tapTarget.native;

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
