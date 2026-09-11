import { I18nManager, Platform } from 'react-native';

/**
 * Mobile design tokens.
 *
 * Mirrors the web palette so the brand reads the same across surfaces, with
 * values shaped for React Native (numbers, not CSS strings).
 */

export const colors = {
  orange50: '#FFF4ED',
  orange100: '#FFE6D5',
  orange200: '#FFC9AA',
  orange300: '#FFA474',
  orange400: '#FF7A3C',
  orange500: '#FF6B2C',
  orange600: '#F04E0A',
  orange700: '#C73C07',

  ink900: '#16181D',
  ink800: '#21242B',
  ink700: '#333741',
  ink600: '#4A4F5C',
  ink500: '#6B7280',
  ink400: '#9AA1AD',
  ink300: '#C7CCD4',
  ink200: '#E3E6EB',
  ink100: '#F1F3F6',
  ink50: '#F8F9FB',

  white: '#FFFFFF',
  success: '#12B76A',
  successBg: '#ECFDF3',
  warning: '#F79009',
  warningBg: '#FFFAEB',
  danger: '#F04438',
  dangerBg: '#FEF3F2',

  surface: '#FFFFFF',
  background: '#F8F9FB',
  border: '#E3E6EB',
  textPrimary: '#16181D',
  textSecondary: '#4A4F5C',
  textMuted: '#6B7280',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

export const typography = {
  // Cairo ships with the app; the platform fallback keeps Arabic readable if
  // font loading fails on a low-end device (plan §135).
  fontFamily: Platform.select({ ios: 'Cairo', android: 'Cairo', default: 'System' }),
  h1: { fontSize: 26, fontWeight: '800' as const, lineHeight: 34 },
  h2: { fontSize: 20, fontWeight: '700' as const, lineHeight: 28 },
  h3: { fontSize: 17, fontWeight: '700' as const, lineHeight: 24 },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 24 },
  bodyBold: { fontSize: 15, fontWeight: '700' as const, lineHeight: 24 },
  caption: { fontSize: 13, fontWeight: '400' as const, lineHeight: 20 },
  tiny: { fontSize: 11, fontWeight: '600' as const, lineHeight: 16 },
} as const;

export const shadows = {
  card: Platform.select({
    ios: {
      shadowColor: '#101828',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
    },
    android: { elevation: 2 },
    default: {},
  }),
  raised: Platform.select({
    ios: {
      shadowColor: '#101828',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.1,
      shadowRadius: 16,
    },
    android: { elevation: 6 },
    default: {},
  }),
} as const;

/** Minimum touch target (plan §134). */
export const TAP_TARGET = 48;

/**
 * Force RTL at startup.
 *
 * Release 1 is Arabic-only, so the layout direction is a product decision, not
 * something to inherit from the device locale — a phone set to English must
 * still render Jibli right-to-left (plan §2).
 *
 * Must run before the first render. `forceRTL` requires an app restart to take
 * effect on a fresh install, which Expo handles on the next launch.
 */
export function enforceRtl(): void {
  if (!I18nManager.isRTL) {
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(true);
  }
}

/** True once the native layer is actually laying out RTL. */
export function isRtlActive(): boolean {
  return I18nManager.isRTL;
}
