import type { ExpoConfig } from 'expo/config';

/**
 * Expo configuration.
 *
 * Plan §168: request only the permissions the product actually needs. Release 1
 * has no live GPS (plan §51), so there is no background-location entitlement
 * here — adding one "just in case" would fail store review and expand the
 * privacy surface for a feature that does not exist yet.
 */
const config: ExpoConfig = {
  name: 'جيبلي',
  slug: 'jibli',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'jibli',
  userInterfaceStyle: 'light',
  // The app is Arabic-only in Release 1 and RTL is forced, not inferred from
  // the device locale (plan §2).
  extra: { forceRTL: true },
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#FF6B2C',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'iq.jibli.app',
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
      // Foreground-only, and only to help place a delivery pin (plan §13).
      NSLocationWhenInUseUsageDescription:
        'نستخدم موقعك لتحديد عنوان التوصيل بدقة. يمكنك أيضاً اختيار الموقع يدوياً.',
      NSCameraUsageDescription: 'لالتقاط صورة إثبات التسليم عند الحاجة.',
    },
  },
  android: {
    package: 'iq.jibli.app',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#FF6B2C',
    },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'POST_NOTIFICATIONS'],
    // Never ACCESS_BACKGROUND_LOCATION: Release 1 does not track drivers.
  },
  plugins: ['expo-router', 'expo-secure-store', 'expo-localization'],
  experiments: { typedRoutes: true },
};

export default config;
