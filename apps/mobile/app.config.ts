import type { ExpoConfig } from 'expo/config';
import { withAndroidManifest, type ConfigPlugin } from 'expo/config-plugins';

/**
 * Expo configuration.
 *
 * Plan §168: request only the permissions the product actually needs. Release 1
 * has no live GPS (plan §51), so there is no background-location entitlement
 * here — adding one "just in case" would fail store review and expand the
 * privacy surface for a feature that does not exist yet.
 */

/**
 * Whether EAS is building the profile that goes to a store.
 *
 * EAS sets this on its builders; it is undefined on a laptop running
 * `expo start`, which is the distinction that matters below.
 */
const isStoreBuild = process.env.EAS_BUILD_PROFILE === 'production';

/**
 * Placeholders that must not survive into a submitted binary.
 *
 * Every value here is read when this file is evaluated and **baked into the
 * binary** — so a build made with the defaults is a build with dead links
 * inside it, and no `eas update` can reach them afterwards. That is the
 * mechanism that makes this worth failing a build over rather than noting in a
 * runbook: the mistake is unrecoverable by the cheap path, and it is silent.
 *
 * Each of these has a specific consequence:
 *
 *   `jibli.iq` has no DNS. «سياسة الخصوصية» and «الشروط» in حسابي are two rows
 *   App Review opens, and a privacy policy that does not resolve is a rejection
 *   on both stores — App Store 5.1.1 and 1.5, and Play refuses the listing.
 *
 *   `tile.openstreetmap.org` is a donated server whose usage policy explicitly
 *   forbids a distributed application from pointing at it. Shipping it is a
 *   licence problem, not a performance one, and the free tier of any tile
 *   vendor covers this app several times over.
 *
 * Checked only for a store build so that `expo start`, Expo Go and the preview
 * APK keep working untouched for anyone who just wants to run the app.
 */
function requireForStore(name: string, value: string | undefined, placeholder: string): string {
  const resolved = value ?? placeholder;

  if (isStoreBuild && resolved === placeholder) {
    throw new Error(
      `${name} is still the placeholder (${placeholder}).\n` +
        `It is baked into the binary at build time, so a production build with ` +
        `this value cannot be fixed by an update — only by another submission.\n` +
        `Set ${name} in eas.json's production profile before building.`,
    );
  }

  return resolved;
}

const privacyPolicyUrl = requireForStore(
  'EXPO_PUBLIC_PRIVACY_URL',
  process.env.EXPO_PUBLIC_PRIVACY_URL,
  'https://jibli.iq/privacy',
);

const termsUrl = requireForStore(
  'EXPO_PUBLIC_TERMS_URL',
  process.env.EXPO_PUBLIC_TERMS_URL,
  'https://jibli.iq/terms',
);

/**
 * The number «تواصل معنا» dials, which App Review tries (guideline 1.5).
 *
 * Past the placeholder it must still be a number a phone can call: an Iraqi
 * number in international form, so a typo is a failed build rather than a
 * dead support row in every installed copy.
 */
const supportPhone = requireForStore(
  'EXPO_PUBLIC_SUPPORT_PHONE',
  process.env.EXPO_PUBLIC_SUPPORT_PHONE,
  '+9647700000000',
);
if (isStoreBuild && !/^\+964\d{9,10}$/.test(supportPhone)) {
  throw new Error(
    `EXPO_PUBLIC_SUPPORT_PHONE must be an Iraqi number in international form ` +
      `(+964…), and it is baked into the binary.`,
  );
}

/**
 * Release 1 signs in with a phone number and a code, and nothing else.
 *
 * A Google button on iOS obliges Sign in with Apple beside it (App Store
 * guideline 4.8), which is not built, and the store forms, the privacy
 * manifest and the policy all describe a phone-only sign-in. The button
 * appears whenever a client id is present — and a client id set as an EAS
 * environment variable never shows in this repository — so a store build
 * refuses one outright. Remove this when Sign in with Apple ships.
 */
if (isStoreBuild) {
  const googleIds = [
    'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID',
    'EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID',
    'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID',
  ].filter((name) => process.env[name]);
  if (googleIds.length > 0) {
    throw new Error(
      `${googleIds.join(', ')} set for a store build. Release 1 is phone and code ` +
        `only: Google sign-in on iOS needs Sign in with Apple beside it.`,
    );
  }
}

/**
 * An Android store build without Firebase cannot receive a single push: the
 * order alerts a shop owner depends on would never arrive, while the app still
 * asks for the notification permission. EAS sets EAS_BUILD_PLATFORM on its
 * builders, so this stops the Android build and leaves iOS (APNs, held by EAS)
 * alone.
 */
if (
  isStoreBuild &&
  process.env.EAS_BUILD_PLATFORM === 'android' &&
  !process.env.GOOGLE_SERVICES_JSON
) {
  throw new Error(
    'GOOGLE_SERVICES_JSON is not set for this Android store build, so FCM — and ' +
      'every push notification — would be missing from it. Upload ' +
      'google-services.json as the GOOGLE_SERVICES_JSON file variable on EAS.',
  );
}

const config: ExpoConfig = {
  /*
   * The home-screen name, and the default for every language without an entry
   * in `locales` below.
   *
   * Arabic rather than «Jibli» because that is what an Iraqi customer is
   * looking for on their own home screen, and because a phone in Arabic
   * showing a Latin label among Arabic ones reads as a foreign app. English
   * phones get «Jibli» from `locales/en.json`.
   *
   * Deliberately not «جيبلي Jibli» as one string: the home screen truncates at
   * roughly eleven characters, so it would render «جيبلي Jib…» — and a short
   * mixed-script label in an RTL context orders differently on iOS and Android,
   * which is a bug nobody can see in a screenshot. Both scripts belong in the
   * *store listing* name, which is what search ranks; see
   * docs/operations/store-submission.md.
   */
  name: 'جيبلي',
  slug: 'jibli',
  /** The EAS account the builds and updates belong to. */
  owner: 'sam7iq',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'jibli',
  userInterfaceStyle: 'light',
  icon: './assets/icon.png',

  /*
   * The app's name in the phone's language: «Jibli» on an English phone,
   * «جيبلي» everywhere else, on both platforms.
   *
   * Every key in these files must be nested under "ios" or "android". A
   * top-level key goes to both, and iOS keys landing in Android resources is
   * what failed the first release builds in lint — see locales/README.md.
   */
  locales: {
    ar: './locales/ar.json',
    en: './locales/en.json',
  },

  /**
   * Over-the-air updates.
   *
   * Both stores review a binary. They do not review the JavaScript inside it,
   * provided an update does not change what the app is for — which is why a
   * typo in an Arabic string, a wrong delivery fee label or a crash on one
   * screen does not have to cost a review cycle. Without this, every one of
   * those is a new build, a new submission and days of waiting.
   *
   * `runtimeVersion` from `appVersion` is the safety catch that makes it
   * honest: an update is only ever offered to a binary built from the same
   * `version`. Add a native module or bump the version and the old binaries
   * simply stop being offered updates rather than being handed JavaScript that
   * calls into native code they do not contain.
   *
   * `fallbackToCacheTimeout: 0` because the alternative is holding the splash
   * screen while a phone on Iraqi mobile data decides whether an update exists.
   * The app launches on what it already has and picks the new bundle up on the
   * next launch.
   */
  runtimeVersion: { policy: 'appVersion' },
  updates: {
    url: 'https://u.expo.dev/1ff0b9e5-8d38-484c-8d8a-232641ede9cc',
    fallbackToCacheTimeout: 0,
  },
  // The app is Arabic-only in Release 1 and RTL is forced, not inferred from
  // the device locale (plan §2).
  extra: {
    eas: { projectId: '1ff0b9e5-8d38-484c-8d8a-232641ede9cc' },
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
     * An optional keyed raster vendor for the map (MapTiler, Stadia…).
     *
     * Optional in every build: unset, `map-picker-html.ts` draws OpenFreeMap
     * vector tiles, which need no key and permit commercial use. It is read
     * here only so the value sits with the rest of the app's configuration.
     */
    /*
     * Unset values are left `undefined`, never `null`: the release build
     * embedded a `null` here as `{}`, which is truthy, and that is what
     * crashed the first APK on launch. `undefined` is simply dropped. Read
     * these through `src/lib/app-config.ts`, which refuses anything but a
     * string either way.
     */
    mapTileUrl: process.env.EXPO_PUBLIC_MAP_TILE_URL,
    mapTileAttribution: process.env.EXPO_PUBLIC_MAP_TILE_ATTRIBUTION,
    supportPhone,
    /*
     * The App Store numeric id, for the «حدّث التطبيق» button.
     *
     * It does not exist until App Store Connect has issued it, which is after
     * the first build — so this is genuinely optional rather than lazily
     * unset, and `UpdateGate` opens a store *search* for the name when it is
     * missing. A link to `id/undefined` would be worse than a search.
     * Not guarded by `requireForStore` for the same reason.
     */
    iosAppId: process.env.EXPO_PUBLIC_IOS_APP_ID,
    /*
     * Where crash reports go, if anywhere.
     *
     * Deliberately *not* passed through `requireForStore`: a DSN is not a
     * correctness requirement the way a privacy policy is, and refusing to
     * build without one would block a release over telemetry. Absent, the SDK
     * is never initialised — see `src/lib/monitoring.ts`.
     *
     * A Sentry DSN is not a secret in the usual sense; it ships in every
     * client, and its only capability is to receive events. It still lives in
     * the environment rather than here so that a project can be changed without
     * a code change.
     */
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    /*
     * Both resolved above rather than here, because a store build must not be
     * allowed to bake the placeholder — see `requireForStore`.
     */
    privacyPolicyUrl,
    termsUrl,
  },
  /*
   * The four files the app actually ships, named rather than globbed.
   *
   * The old glob swept in everything under `assets/`, which was harmless while
   * the directory held four icons — and is a trap the moment somebody drops a
   * comp, a source PSD export or a spare banner in there to look at: it enters
   * the binary silently and nothing in review points at it. Naming them means
   * a new bundled asset is a deliberate line in this file.
   */
  assetBundlePatterns: [
    'assets/icon.png',
    'assets/adaptive-icon.png',
    'assets/splash.png',
    'assets/splash-android.png',
  ],
  web: { favicon: './assets/favicon.png' },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'iq.jibli.app',
    /*
     * What the app collects, declared rather than inferred.
     *
     * Required since May 2024. Expo's own pods each ship a
     * `PrivacyInfo.xcprivacy` for the APIs they call, which is what Apple's
     * automated check reads for third-party SDKs — but the *app-level* manifest
     * is ours, and without it there is no statement that Jibli does not track.
     *
     * `NSPrivacyTracking: false` is the honest answer and the load-bearing one:
     * there is no advertising SDK and no third-party analytics in this binary,
     * which is also why there is no `NSUserTrackingUsageDescription` and no ATT
     * prompt. Adding either would be claiming a capability the app does not have.
     *
     * The collected types match what App Privacy in App Store Connect must say,
     * and a mismatch between the two is the thing that gets noticed.
     */
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePhoneNumber',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeName',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          /* The delivery pin, attached to an address the customer saved. */
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePreciseLocation',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          /*
           * The same pin when the customer allows only approximate location —
           * iOS lets them turn precise off in the permission prompt.
           */
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeCoarseLocation',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          /* The delivery address the customer types: district, street, landmark. */
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePhysicalAddress',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          /*
           * The account's own identifier, and a shop owner's or driver's
           * username — the "User ID" Apple asks about.
           */
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeUserID',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          /*
           * Device model, OS version and app version, stored with the push
           * token to diagnose a notification that does not arrive.
           */
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeOtherDiagnosticData',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          /* Order history — what was bought, from where. */
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePurchaseHistory',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          /* A shop's product photos and its own picture, taken or chosen by the owner. */
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePhotosorVideos',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          /*
           * A review's stars and comment, which the shop and other readers see,
           * and a shop's own product names and descriptions. Deleted with the
           * account (DELETE /api/v1/profile).
           */
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeOtherUserContent',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        /*
         * Declared only when the build actually collects it: an email arrives
         * only through Google sign-in, and crash data only when a Sentry DSN is
         * baked in. A manifest that claims data the binary never collects is
         * as wrong as one that omits data it does.
         */
        ...(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
          ? [
              {
                NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeEmailAddress',
                NSPrivacyCollectedDataTypeLinked: true,
                NSPrivacyCollectedDataTypeTracking: false,
                NSPrivacyCollectedDataTypePurposes: [
                  'NSPrivacyCollectedDataTypePurposeAppFunctionality',
                ],
              },
            ]
          : []),
        ...(process.env.EXPO_PUBLIC_SENTRY_DSN
          ? [
              {
                NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeCrashData',
                NSPrivacyCollectedDataTypeLinked: false,
                NSPrivacyCollectedDataTypeTracking: false,
                NSPrivacyCollectedDataTypePurposes: [
                  'NSPrivacyCollectedDataTypePurposeAppFunctionality',
                ],
              },
            ]
          : []),
      ],
      /*
       * Required-reason APIs this binary reaches, through its dependencies
       * rather than through code of ours: `expo-secure-store` and React Native's
       * own settings layer read UserDefaults. CA92.1 is the "app itself only"
       * reason, which is what both do — nothing here is shared with a broker.
       */
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
      ],
    },
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
      /*
       * The languages the bundle claims, which is what makes `locales` above
       * take effect: iOS matches the phone's language against this list before
       * it looks for an `.lproj` directory, and an unlisted language falls
       * straight back to `name` without ever reading the file.
       *
       * It is also what the App Store listing shows under "Languages".
       */
      CFBundleLocalizations: ['ar', 'en'],
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
      /*
       * HTTPS only. Expo's template allows arbitrary loads, which App Review
       * notices and asks about; every host this app talks to — the API, the
       * asset store, the map tiles — is HTTPS, so the honest answer is no.
       * `localhost` stays exempt for a development build talking to a local
       * API through a port forward; a phone on the LAN uses Expo Go, which
       * carries its own plist.
       */
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
        NSExceptionDomains: { localhost: { NSExceptionAllowsInsecureHTTPLoads: true } },
      },
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
       * The camera and the photo library are declared by the `expo-image-picker`
       * plugin below, with their own strings, because Owner Mode photographs
       * products and the shop's picture. A purpose string for a capability the
       * app does not use is a rejection in its own right, which is why the
       * microphone is switched off on both media plugins.
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
    /*
     * What libraries add that this app never uses, removed from the merged
     * manifest. Read off the release APK: SYSTEM_ALERT_WINDOW is «display over
     * other apps», which Play treats as sensitive and asks to justify; the
     * storage pair and the biometric pair come from modules whose file and
     * biometric features nothing here calls. A permission the app does not
     * need is a question in review with no good answer.
     */
    blockedPermissions: [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.USE_BIOMETRIC',
      'android.permission.USE_FINGERPRINT',
      // Belt to the braces above: no module here records anything.
      'android.permission.RECORD_AUDIO',
    ],
    /*
     * Firebase, which is how a push notification reaches an Android phone at all.
     *
     * iOS needs nothing here — EAS holds the APNs key and Apple routes on the
     * bundle id. Android has no such thing: every notification goes through FCM,
     * and FCM identifies the app by the sender id inside `google-services.json`.
     * Without that file the build succeeds, `POST_NOTIFICATIONS` is still asked
     * for, the customer still says yes — and `getExpoPushTokenAsync` fails, so
     * no notification ever arrives. A permission granted for nothing, which is
     * worse than never asking.
     *
     * Spread conditionally rather than written as a constant path, because the
     * file is a credential: it is gitignored, it is not on a fresh clone, and a
     * key pointing at a missing file fails `prebuild` for anyone who only wants
     * to run the app. On EAS it arrives as the `GOOGLE_SERVICES_JSON` secret
     * file and this picks it up; locally, drop the file beside app.config.ts.
     *
     * Absent, everything except Android push still works — which is the right
     * failure, and `scripts/preflight.mjs` says so out loud rather than leaving
     * it to be discovered after a release.
     */
    ...(process.env.GOOGLE_SERVICES_JSON
      ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON }
      : {}),
  },
  plugins: [
    'expo-router',
    /*
     * The keystore, without the Face ID purpose string the plugin writes by
     * default: nothing here asks for biometric authentication, and a string
     * for a capability the app never uses is a question in review.
     */
    ['expo-secure-store', { faceIDPermission: false }],
    /*
     * Location, stated exactly. Left to its defaults the plugin declares the
     * «always» and motion-activity purpose strings as well, in English —
     * three capabilities the app does not have, on the one screen App Review
     * reads most carefully. Foreground, once, in Arabic, and nothing else.
     */
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'لتحديد موقع التوصيل بدقة عند حفظ عنوانك. يمكنك دائماً كتابة العنوان يدوياً بدلاً من ذلك.',
        locationAlwaysPermission: false,
        locationAlwaysAndWhenInUsePermission: false,
        motionUsagePermission: false,
        isIosBackgroundLocationEnabled: false,
        isAndroidBackgroundLocationEnabled: false,
        isAndroidForegroundServiceEnabled: false,
      },
    ],
    /*
     * RTL decided natively, before JavaScript runs.
     *
     * This was the single worst defect in the app and it was invisible in
     * development. `enforceRtl()` in src/theme/index.ts calls
     * `I18nManager.forceRTL(true)`, which writes a native flag that is only
     * read when the process starts — so on a *fresh install* the flag is
     * written by a process that has already laid itself out left-to-right.
     * Every first launch, for every new customer, drew the whole Arabic app
     * mirrored: headers reversed, back chevrons pointing the wrong way, the tab
     * bar in the wrong order. The second launch was fine, which is exactly why
     * nobody developing it ever saw the problem.
     *
     * It is also the first screen App Review sees, on a device that has never
     * run the app before.
     *
     * These two options make the plugin write `ExpoLocalization_forcesRTL` into
     * Info.plist and strings.xml at build time, so the flag is already true
     * when the native layer starts and there is no first launch to get wrong.
     * `enforceRtl()` stays as the belt to this braces — and because the web
     * preview has no native layer to read these.
     *
     * Not testable in Expo Go: it changes native resources, so it needs a
     * development build or the `preview` APK.
     */
    ['expo-localization', { supportsRTL: true, forcesRTL: true }],
    /*
     * Notifications, configured rather than defaulted.
     *
     * The module has been a dependency and `registerForPush` has been calling
     * it since checkout learned to ask — but with no plugin block Android
     * renders the notification icon from the launcher icon, which it flattens
     * to a white silhouette. The Jibli pin becomes a white blob.
     *
     * The icon must be a *monochrome* asset with transparency, which is what
     * `splash-android.png` already is: the mark in white on nothing. Android
     * tints it with `color` and the result is the brand mark rather than a
     * square. One asset doing two jobs, both of which want the same shape.
     */
    /*
     * `sounds` bundles the new-order chime into the native build, so a push
     * for a shop's new order or a courier's new task rings with the same three
     * notes the app plays when it is open. The `work` channel (created in
     * src/lib/push.ts) points at it; customer updates stay on `orders` with
     * the system sound.
     */
    [
      'expo-notifications',
      {
        icon: './assets/splash-android.png',
        color: '#FF5400',
        defaultChannel: 'orders',
        sounds: ['./assets/sounds/new_order.wav'],
        /*
         * The APNs environment in the entitlements. App Store signing usually
         * rewrites `development` to `production`, but a store build should not
         * depend on that: a binary whose entitlement points at the sandbox
         * gets no notification from the production gateway.
         */
        mode: isStoreBuild ? 'production' : 'development',
      },
    ],
    /*
     * The in-app alert: a shop owner with the app open, or a courier riding
     * with it on the dashboard, hears a new order the moment it lands.
     */
    /*
     * Playback only. Left bare, the plugin also declares RECORD_AUDIO on
     * Android and a microphone purpose string on iOS — a microphone the app
     * never opens, which Play lists as a sensitive permission and asks to
     * justify, and which a reviewer reads as a capability being hidden.
     */
    /*
     * And foreground only. The plugin's default declares background audio on
     * iOS (`UIBackgroundModes: audio`) and a media-playback foreground service
     * on Android — for an app whose only sound is a two-second chime while it
     * is open. Apple rejects a background mode nothing uses (2.5.4), and Play
     * asks for a declaration form for every foreground service type.
     */
    [
      'expo-audio',
      { microphonePermission: false, recordAudioAndroid: false, enableBackgroundPlayback: false },
    ],
    /*
     * The camera and the photo library: a shop's product photos and its own
     * picture, taken where the products are. The strings are what iOS shows
     * on the permission prompt; Android gets its permissions from the plugin.
     */
    [
      'expo-image-picker',
      {
        photosPermission: 'يحتاج جيبلي إلى صورك لإضافة صور المنتجات وصورة المتجر.',
        cameraPermission: 'يحتاج جيبلي إلى الكاميرا لتصوير المنتجات وصورة المتجر.',
        microphonePermission: false,
      },
    ],
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
    /*
     * Two images, because the two platforms want different things.
     *
     * iOS draws the splash as a full-screen storyboard, so the tall 1284×2778
     * artwork with the mark centred in brand orange is exactly right there.
     *
     * Android 12 replaced that with the system splash API: the image becomes
     * `windowSplashScreenAnimatedIcon`, the system scales it to `imageWidth`
     * and *masks it to a circle*. Handing it the tall artwork meant the whole
     * 1284×2778 canvas was fitted into a ~100dp icon slot — leaving the mark
     * about a quarter of its intended size, a dot inside a circle cut out of a
     * mostly-empty orange rectangle, on every Android 12 and newer phone.
     *
     * `splash-android.png` is the square that slot wants: the mark alone on
     * transparency, filling 62% of a 1152 canvas, which keeps it inside the
     * radius the mask leaves. The orange comes from `backgroundColor` here, so
     * the circle and the window behind it are the same colour by construction
     * rather than by two files agreeing on a hex value.
     */
    [
      'expo-splash-screen',
      {
        backgroundColor: '#FF5400',
        image: './assets/splash.png',
        resizeMode: 'contain',
        android: {
          image: './assets/splash-android.png',
          backgroundColor: '#FF5400',
          imageWidth: 180,
        },
      },
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
    /*
     * Crash reporting, because the alternative was launching blind.
     *
     * `error-boundary.tsx` wrote `console.error` and nothing else — which in a
     * release build goes nowhere at all. A crash affecting a slice of Android
     * users would have surfaced first as a one-star review.
     *
     * That gap mattered more here than it usually does: `expo-updates` is
     * configured, so the ability to ship a fix in minutes was already excellent.
     * What was missing was any way to know *what* to fix.
     *
     * The plugin uploads source maps at build time so a stack trace points at
     * `checkout.tsx:117` rather than at a minified bundle offset. Without a DSN
     * (see `src/lib/monitoring.ts`) the SDK stays inert, so a build with no
     * Sentry project configured behaves exactly as it did before.
     */
    '@sentry/react-native',
    /*
     * The release build, trimmed.
     *
     * Expo's template ships Android release builds with R8 minification and
     * resource shrinking off. On, the classes and resources nothing reaches
     * leave the APK — a build that carries a WebView, Sentry, an image
     * loader and a map has megabytes of them — and a smaller dex is a
     * faster cold start. Every module here ships its own keep rules, which
     * is what makes the switch safe; if a release build ever dies with a
     * ClassNotFoundException, this is the first thing to flip back.
     */
    [
      'expo-build-properties',
      {
        android: {
          /*
           * API 36 is what Play requires of a new app. React Native's version
           * catalog says 36 today, but Expo falls back to 35 whenever it
           * cannot read that catalog — stated here, it cannot drift.
           */
          compileSdkVersion: 36,
          targetSdkVersion: 36,
          enableProguardInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
        },
      },
    ],
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

/**
 * expo-location's own manifest declares `LocationTaskService`, a foreground
 * service of type `location`, for background updates. Release 1 reads the
 * position once, in the foreground, to drop a delivery pin; it never starts
 * that service and never asks for FOREGROUND_SERVICE_LOCATION
 * (`isAndroidForegroundServiceEnabled: false` above). A declared location
 * service is still a question in Play review, so the merged manifest drops it.
 */
const withoutLocationTaskService: ConfigPlugin = (input) =>
  withAndroidManifest(input, (mod) => {
    const manifest = mod.modResults.manifest;
    manifest.$['xmlns:tools'] ??= 'http://schemas.android.com/tools';
    const application = manifest.application?.[0];
    if (application) {
      const name = 'expo.modules.location.services.LocationTaskService';
      application.service = [
        ...(application.service ?? []).filter((service) => service.$['android:name'] !== name),
        { $: { 'android:name': name, 'tools:node': 'remove' } as never },
      ];
    }
    return mod;
  });

export default withoutLocationTaskService(config);
