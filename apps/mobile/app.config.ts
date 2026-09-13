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
  icon: './assets/icon.png',
  // The app is Arabic-only in Release 1 and RTL is forced, not inferred from
  // the device locale (plan §2).
  extra: {
    forceRTL: true,
    /*
     * Reachable from inside the app, not only from the store listing.
     *
     * App Review checks that the privacy policy is linked in-app (5.1.1), and
     * that there is a way to reach a human (1.5). Both are rows on the account
     * screen, and both are configuration rather than code so that changing a
     * support number does not need a release.
     */
    supportPhone: process.env.EXPO_PUBLIC_SUPPORT_PHONE ?? '+9647700000000',
    privacyPolicyUrl: process.env.EXPO_PUBLIC_PRIVACY_URL ?? 'https://jibli.iq/privacy',
    termsUrl: process.env.EXPO_PUBLIC_TERMS_URL ?? 'https://jibli.iq/terms',
  },
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#FF5400',
  },
  assetBundlePatterns: ['**/*'],
  web: { favicon: './assets/favicon.png' },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'iq.jibli.app',
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
      // Foreground-only, and only to help place a delivery pin (plan §13).
      NSLocationWhenInUseUsageDescription:
        'نستخدم موقعك لتحديد عنوان التوصيل بدقة. يمكنك أيضاً اختيار الموقع يدوياً.',
      /*
       * No NSCameraUsageDescription.
       *
       * It used to claim delivery-proof photography, which the *customer* app
       * never does — that is Driver Mode's job, and it does not ship in this
       * binary. A purpose string for a capability the app does not use is
       * itself a rejection, and it also shows up in the App Privacy label as a
       * data type Jibli does not collect.
       */
    },
  },
  android: {
    package: 'iq.jibli.app',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#FF5400',
    },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'POST_NOTIFICATIONS'],
    // Never ACCESS_BACKGROUND_LOCATION: Release 1 does not track drivers.
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-localization',
    /*
     * The splash is held by the app until fonts and the session have resolved
     * (see src/app/_layout.tsx), so the plugin must not hide it on its own.
     */
    ['expo-splash-screen', { backgroundColor: '#FF5400', image: './assets/splash.png' }],
  ],
  experiments: { typedRoutes: true },
};

export default config;
