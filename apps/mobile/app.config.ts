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
     * Where the app talks to.
     *
     * This is read when the config is evaluated — when `expo start` boots or a
     * build runs — so the value is baked into the binary, not looked up at
     * runtime. It had no entry here at all, which meant `src/lib/api.ts` fell
     * through to `http://localhost:4000`: an app that works on the machine
     * that built it and on no other device, failing with a network error that
     * says nothing about the cause.
     *
     * The default is the deployed API rather than localhost for the same
     * reason: the common case is a phone, and a phone cannot reach the
     * developer's localhost. Point it elsewhere with EXPO_PUBLIC_API_URL —
     * `http://<your LAN ip>:4000` for a local server, never `localhost`.
     */
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'https://jibli-api.onrender.com',
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
      /*
       * One capability, and the string says exactly what it is for.
       *
       * Foreground location only, used once — when the customer taps «تحديد
       * موقعي» while saving a delivery address — to attach a point to it. The
       * app never reads a position in the background and never tracks anyone:
       * there is no background entitlement here and ADR-0005 explains why
       * there is no driver tracking either.
       *
       * Camera is still absent. It claimed delivery-proof photography, which
       * is Driver Mode's job and does not ship in this binary, and a purpose
       * string for an unused capability is a rejection in its own right.
       */
      NSLocationWhenInUseUsageDescription:
        'لتحديد موقع التوصيل بدقة عند حفظ عنوانك. يمكنك دائماً كتابة العنوان يدوياً بدلاً من ذلك.',
    },
  },
  android: {
    package: 'iq.jibli.app',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#FF5400',
    },
    /*
     * Only what the app uses. Notifications are real — `expo-notifications`
     * registers a token after sign-in — and coarse/fine location is asked for
     * once, when the customer attaches a point to a delivery address.
     *
     * Never ACCESS_BACKGROUND_LOCATION: Release 1 does not track anyone, and
     * the entitlement is the hardest one to justify to either store.
     */
    permissions: ['POST_NOTIFICATIONS', 'ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
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
  experiments: {
    typedRoutes: true,
    /*
     * Off deliberately. Metro would otherwise apply `tsconfig.json`'s `paths`
     * to runtime resolution, and this project pins `react` there so that TS
     * resolves the React 18 typings — which would make the bundler resolve
     * `react` to `@types/react`, a package containing no JavaScript. The app
     * failed to bundle at all. The `@/` alias is handled by Babel instead;
     * see babel.config.js.
     */
    tsconfigPaths: false,
  },
};

export default config;
