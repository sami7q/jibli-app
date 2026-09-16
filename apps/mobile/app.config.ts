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
     * Google sign-in, off until these are filled in.
     *
     * Three ids for one application, because Google issues one per platform.
     * They are not secrets — they ship in every client — but they differ
     * between a development project and a production one, so they are
     * configuration rather than constants. The sign-in screen hides the button
     * when they are absent: a Google button that fails is worse than none.
     *
     * Shipping this on iOS obliges Sign in with Apple beside it (App Store
     * guideline 4.8). That work is not done.
     */
    google: {
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
      androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    },
    /*
     * Reachable from inside the app, not only from the store listing.
     *
     * App Review checks that the privacy policy is linked in-app (5.1.1), and
     * that there is a way to reach a human (1.5). Both are rows on the account
     * screen, and both are configuration rather than code so that changing a
     * support number does not need a release.
     */
    /*
     * Where the map's tiles come from.
     *
     * Read here only so the value is visible in one place with the rest of the
     * app's configuration; `map-picker-html.ts` reads the same variables. The
     * default is OpenStreetMap's donated server, which its usage policy allows
     * for development and not for a distributed app — so a launch build sets
     * these to a provider with a key. MapTiler, Stadia and Thunderforest all
     * have free tiers far above what this needs: a picking session is about
     * forty-five tiles, and a thousand customers saving two addresses each
     * comes to under a hundred thousand requests in total.
     */
    mapTileUrl: process.env.EXPO_PUBLIC_MAP_TILE_URL ?? null,
    mapTileAttribution: process.env.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION ?? null,
    supportPhone: process.env.EXPO_PUBLIC_SUPPORT_PHONE ?? '+9647700000000',
    privacyPolicyUrl: process.env.EXPO_PUBLIC_PRIVACY_URL ?? 'https://jibli.iq/privacy',
    termsUrl: process.env.EXPO_PUBLIC_TERMS_URL ?? 'https://jibli.iq/terms',
  },
  assetBundlePatterns: ['**/*'],
  web: { favicon: './assets/favicon.png' },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'iq.jibli.app',
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
      /*
       * Answered here so the build does not stop to ask.
       *
       * Every App Store Connect upload prompts for an export-compliance answer
       * and holds the build until somebody clicks through it — which, on a
       * release being pushed at ten at night, is a wasted evening.
       *
       * `false` is the honest answer: the app uses HTTPS and the platform
       * keychain, both of which are the exempt category. It performs no
       * encryption of its own and ships no cryptographic implementation. If
       * that ever changes — a bundled cipher, a custom protocol — this has to
       * change with it, because the declaration is a legal one.
       */
      ITSAppUsesNonExemptEncryption: false,
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
    /*
     * Target API level: 36, from the SDK rather than from here.
     *
     * Play refuses a new submission below API 36 as of 31 August 2026 — and it
     * refuses it at upload, not at review, so the floor is not something an
     * appeal can reach. Expo SDK 57 clears it comfortably.
     *
     * The project moved 54 → 57 because Expo Go on iOS ships only the newest
     * SDK: an iPhone could not open the project at all, and unlike Android
     * there is no way to install an older Expo Go beside it.
     *
     * Deliberately not restated as `targetSdkVersion` here: that key belongs
     * to `expo-build-properties`, and installing a config plugin to repeat a
     * default is a dependency that exists only to be forgotten and drift. When
     * the floor next moves, the SDK moves with it.
     */
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
     * Required since SDK 54: fonts are embedded at build time by the plugin
     * rather than loaded from the bundle at runtime. Without it the Cairo
     * faces are missing on a release build and every screen falls back to the
     * system Arabic face — which is exactly the reflow `useFonts` exists to
     * prevent, except permanent.
     */
    'expo-font',
    /*
     * Required from SDK 57: the in-app browser is a config plugin now rather
     * than a runtime-only module. `expo install --fix` refuses to edit a
     * dynamic config like this one and prints the block to add, which is easy
     * to scroll past — without it the OAuth and terms links open nothing on a
     * release build.
     */
    'expo-web-browser',
    /*
     * The splash is held by the app until fonts and the session have resolved
     * (see src/app/_layout.tsx), so the plugin must not hide it on its own.
     *
     * The plugin is now the only place it is configured. SDK 57 removed the
     * top-level `splash` key from ExpoConfig — it had been the older of two
     * ways to say the same thing, and this project set both. `resizeMode`
     * moved here with it; without it the artwork is cropped to fill instead of
     * fitted, which on a tall phone cuts the wordmark in half.
     */
    [
      'expo-splash-screen',
      { backgroundColor: '#FF5400', image: './assets/splash.png', resizeMode: 'contain' },
    ],
    /*
     * Every photograph in the app goes through `expo-image` rather than React
     * Native's own `Image`, and on SDK 57 that is a config plugin — `expo
     * install` prints this block and refuses to write a dynamic config, which
     * is easy to miss until a release build has no pictures in it.
     *
     * What it buys, in order of how much it matters here: a bitmap decoded to
     * the size it is drawn at rather than the size it was stored at, which is
     * what makes a 1920-wide banner affordable on a cheap Android phone; a
     * disk cache that survives the process; and a fade instead of a pop when
     * an image lands on a slow connection, which is most of them.
     */
    'expo-image',
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
