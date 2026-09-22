# Runbook — submitting to the App Store and Google Play

What is already handled in the repository, and what is still a form somebody
has to fill in. Written to be read once before the first submission and again
before each one after.

## Handled in code

Each of these is a documented rejection reason that has already been closed.

| Requirement                                                                      | Where                                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **App Store 5.1.1(ii)** — no account required for content that does not need one | `(auth)/welcome.tsx` offers browsing as a guest; the number is asked for at checkout  |
| **App Store 5.1.1(v)** — account deletion inside the app                         | `(tabs)/account.tsx` → `DeleteAccountSheet`, `DELETE /api/v1/profile`                 |
| **App Store 4.8** — a privacy-respecting login beside any third-party one        | No third-party login ships. See "Google sign-in" below before changing that           |
| **Play target API level** — API 36 since 31 August 2026                          | Expo SDK 57, which targets 36 and above                                               |
| **Export compliance**                                                            | `ITSAppUsesNonExemptEncryption: false` in `app.config.ts`                             |
| **Permission purpose strings**                                                   | `NSLocationWhenInUseUsageDescription`, in Arabic, naming the one screen that uses it  |
| **Least privilege**                                                              | Android asks for three permissions. No camera, and never `ACCESS_BACKGROUND_LOCATION` |
| **Privacy policy and terms reachable in-app**                                    | Two rows in `(tabs)/account.tsx`, from `extra.privacyPolicyUrl` / `extra.termsUrl`    |
| **RTL on first launch**                                                          | `['expo-localization', { forcesRTL: true }]` — see "The first launch was mirrored"   |
| **iOS privacy manifest**                                                         | `ios.privacyManifests` in `app.config.ts`, `NSPrivacyTracking: false`                |
| **Android 12+ splash**                                                           | A square `assets/splash-android.png`; the tall one is masked to a circle             |
| **Forced update path**                                                           | `APP_VERSION_UNSUPPORTED` → `src/ui/update-gate.tsx`                                 |
| **Store build cannot bake a placeholder URL**                                    | `requireForStore()` in `app.config.ts` throws on `EAS_BUILD_PROFILE=production`      |

### The first launch was mirrored, and that is what review would have seen

`enforceRtl()` calls `I18nManager.forceRTL(true)`, which writes a flag the
native layer reads **at process start**. On a fresh install it was therefore
written by a process that had already laid itself out left-to-right — so the
very first run of the app, for every new customer and for App Review on a
device that has never seen it, drew the whole Arabic UI mirrored. The second
launch was correct, which is precisely why it survived development.

`forcesRTL: true` on the `expo-localization` plugin writes
`ExpoLocalization_forcesRTL` into `Info.plist` and `strings.xml` at build time,
so the flag is already true before any JavaScript runs. `enforceRtl()` stays for
the web preview, which has no native layer.

**It cannot be verified in Expo Go** — it changes native resources. Confirm it on
a `preview` APK installed on a phone that has never had the app.

### Before every production build

```sh
cd apps/mobile && pnpm release:check
```

Separate from `pnpm mobile:check`, which answers "can I run this on my phone".
This one answers "will a store take it": whether the baked-in legal URLs resolve,
whether FCM credentials exist, whether a tile provider is configured, and whether
the generated assets are present. It exits non-zero on anything that blocks.

### Google sign-in and Guideline 4.8

The code exists and is **off**, because `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID` are
unset — `isGoogleSignInConfigured()` is what the sign-in screen asks before
drawing the button. With it off, the app authenticates only through its own
phone OTP, which is the "exclusively your own account system" case 4.8 exempts.

**Setting an iOS client id changes that.** 4.8 then requires an equivalent
privacy-respecting option beside it — Sign in with Apple is the usual answer,
though any provider meeting the three criteria qualifies. Two safe routes:

1. Add `expo-apple-authentication` and offer Sign in with Apple on iOS.
2. Configure Google for Android only, leaving the iOS client id unset.

Shipping a Google button on iOS without either is a rejection, not a risk.

## Blocking, and verified as of 16 September 2026

Each of these was checked against the running system, not assumed. None is a
form; all of them are work.

### The legal URLs had no domain behind them

`jibli.iq` did not resolve at all — no DNS — so `extra.privacyPolicyUrl` and
`extra.termsUrl` pointed at nothing, from two rows in the account screen that
App Review opens. Both stores refuse a submission without a reachable privacy
policy, and Play additionally requires a **web** account-deletion page beside
the in-app flow.

`apps/legal` is that site: three static pages, no API, no session, cacheable at
the edge. It is deliberately not part of either portal — `portalNextConfig`
sends `Cache-Control: private, no-store` and proxies `/api/*`, and a policy page
that depends on a backend is down when the backend is.

Deploying it is one action in the Vercel dashboard: **New Project → import this
repo → Root Directory `apps/legal`**. It then redeploys on every push like the
other two. After that, either point `jibli.iq` at it, or set
`EXPO_PUBLIC_PRIVACY_URL` and `EXPO_PUBLIC_TERMS_URL` in `eas.json`'s build
profiles to the deployed origin — the app bakes them in at build time, so a
build made before this is a build with dead links in it.

### Only one phone number could sign in

The deployed API runs `OTP_PROVIDER=console`, which generates a real code and
hands it to a provider that logs that an SMS went out and never the code. Every
number except `OTP_TEST_PHONES` therefore got a code nobody could read.

The OTPIQ configuration that works is already proven in the repo root `.env`
and matches the recipe in `render.yaml` line for line. Moving it to Render is
copying nine keys:

```
OTP_PROVIDER=sms_gateway
SMS_GATEWAY_URL=https://api.otpiq.com/api/sms
SMS_GATEWAY_API_KEY           (sk_live_… — a secret, set it unsynced)
SMS_GATEWAY_AUTH_SCHEME=bearer
SMS_GATEWAY_TO_FIELD=phoneNumber
SMS_GATEWAY_SENDER_FIELD=senderId
SMS_GATEWAY_NUMBER_FORMAT=e164_no_plus
SMS_GATEWAY_BODY_FIELD=verificationCode
SMS_GATEWAY_BODY_MODE=code
SMS_GATEWAY_EXTRA_FIELDS={"smsType":"verification","provider":"auto"}
```

`provider: auto` is the WhatsApp path: OTPIQ tries WhatsApp, then Telegram,
then SMS, and degrades on its own for a customer who has none of them.

Two things to check on Render afterwards, both of which fail silently:

- **`OTP_PHONE_ALLOWLIST` must be empty.** While `APP_ENV` is anything but
  `production`, a non-empty allowlist refuses delivery to every number not in
  it — which looks exactly like a broken gateway.
- **`OTP_TEST_PHONES` has been removed, and App Review still has to sign in.**
  It was the fixed-code number a reviewer used, and with a real gateway
  connected it became a back door rather than a necessity. That leaves a gap
  which has to be closed deliberately before submitting — see "The reviewer
  must be able to sign in" below.

### `APP_ENV=production` is a separate, later step

It is tempting to set it at the same time. Do not: the schema refuses to boot
production unless *all* of real Redis, a real OTP provider, a real push
provider, TLS on the database, no test phones, and no localhost in CORS are
satisfied — and `PUSH_PROVIDER` is still `console`. Switching the OTP provider
while staying on `staging` makes sign-in work for real customers today; the
production hardening is its own piece of work.

### The API sleeps

Render's free plan spins the instance down after about fifteen minutes and
takes roughly a minute to wake. A reviewer who opens the app cold sees a
spinner, and "the app did not load" is a 2.1 rejection that costs a review
cycle. Move `jibli-api` to a paid plan before submitting.

### EAS is linked, and updates are wired

`@sam7iq/jibli` (`1ff0b9e5-8d38-484c-8d8a-232641ede9cc`). `eas.json` has both
profiles — `preview` builds an APK for internal testing on the `preview`
channel, `production` an AAB on the `production` channel — and
`submit.production` is still empty: it needs the App Store Connect app id and a
Play service-account key, both of which only exist once the store accounts do.

`expo-updates` is configured, which is what makes "ship it and improve it"
possible on a store timeline. Both stores review a binary and neither reviews
the JavaScript inside it, so a wrong Arabic string or a crash on one screen is:

```sh
cd apps/mobile
eas update --branch production --message "what changed"
```

Minutes, not a review cycle. `runtimeVersion` follows `version`, so an update
only ever reaches binaries built from the same `version` — add a native module
or bump the version and old binaries stop being offered updates rather than
being handed JavaScript that calls into native code they do not have. That is
the rule to remember: **a JavaScript change ships as an update; anything that
touches native needs a new build and a new submission.**

Bumping `version` in `app.config.ts` therefore cuts the update line. Do it when
you mean to, not to mark a JavaScript release.

**What enabling this costs, stated plainly.** An update channel is a second way
to put code on a customer's phone, and it does not pass through either store's
review. Whoever can sign into the EAS account can ship JavaScript to every
installed copy of Jibli — which, in an app that holds phone numbers and home
addresses, is worth saying out loud rather than discovering. `u.expo.dev` is
Expo's own service and the `projectId` in the URL is not a secret (it ships in
every binary); the account is the thing being trusted.

Two mitigations, in the order they are worth doing:

1. **Two-factor on the Expo account, and on the GitHub account that can push to
   `main`.** The cheapest real protection, and the one that is missing most
   often.
2. **Code signing for updates** (`npx expo-updates codesigning:generate`). The
   binary then refuses any update not signed with a key you hold, so a
   compromised EAS account can no longer ship code by itself. It is not set up
   here because it introduces a private key that must be kept out of the
   repository and available at release time, and that is a decision about how
   this project handles secrets rather than a line of configuration. Worth
   doing before the app has real customers, not after.

### The app's name in the two places it appears

They are different things and only one of them is in this repository.

**On the home screen**, under the icon. `name` in `app.config.ts` is «جيبلي», and
`locales/en.json` overrides it to «Jibli» for a phone set to English. That is
iOS only — `@expo/config-plugins` pins localized `Info.plist` strings to iOS, so
Android shows «جيبلي» to everyone. Deliberate: localizing the Android label needs
a config plugin to maintain across SDK upgrades, for a label almost no Iraqi user
will see.

Do **not** set `name` to «جيبلي Jibli». The home screen truncates near eleven
characters, so it renders «جيبلي Jib…», and a short mixed-script string in an RTL
context orders differently between the two platforms.

**In the store listing**, which is what search actually ranks — and where both
scripts belong. Set per-locale in App Store Connect and Play Console, 30
characters each:

| Store     | Locale  | Name                          |
| --------- | ------- | ----------------------------- |
| App Store | ar      | `جيبلي Jibli — توصيل طعام`    |
| App Store | en      | `Jibli جيبلي — Food Delivery` |
| Play      | ar      | `جيبلي Jibli: توصيل طلبات`    |
| Play      | en      | `Jibli — Food Delivery Iraq`  |

Apple's keyword field (100 characters, comma-separated, no spaces after commas):
`توصيل,طعام,مطاعم,ماركت,اكل,طلبات,بغداد,العراق,delivery,food,iraq,baghdad`.
Do not repeat the app name in it — the title and subtitle are already indexed,
and Apple combines terms, so `توصيل` plus `طعام` covers the phrase. Play has no
keyword field; it ranks from the two descriptions, so both names belong there in
prose.

### Smaller

- `assets/adaptive-icon.png` is 1024×1024, regenerated from `icon.png` — the
  432 version was that same artwork downscaled, and the mark sits at about 42%
  of the canvas, inside Android's 66% safe zone and a comfortable fill of the
  masked circle.
- A new **personal** Play developer account must run a closed test with a dozen
  testers opted in continuously for two weeks before production access can even
  be requested. It is the longest item on the calendar and it runs in parallel
  with everything else, so open the account and start the test first. Confirm
  the current numbers in the Play Console — this rule has been revised before.

## Opening the Apple account

Google and Apple ask for different things, and the order matters: on Apple
nothing at all can be created — not a bundle id, not a TestFlight build, not an
APNs key — until the Program membership is active and paid.

**Individual, not organisation.** An organisation enrolment needs a D-U-N-S
number and takes weeks; an individual enrolment needs an Apple ID and an ID
document. The trade-off is public and permanent: an individual's **legal name
becomes the seller name on the App Store**, so the listing will carry a
person's name rather than «جيبلي». Changing it later means transferring the app
to an organisation account, which is a migration, not a setting.

1. **Check the country is supported before spending anything.** Apple publishes
   the list of regions the Developer Program can be joined from, and the card
   used for the fee must clear internationally. This is the step that stops
   people, and it stops them after they have filled everything else in.
2. **Apple ID with two-factor authentication**, on an account whose name
   matches the identity document. Enrolment refuses a mismatch.
3. **Enrol.** The Apple Developer app on an iPhone is the shortest path for an
   individual — it verifies identity against the device — and
   `developer.apple.com/programs/enroll` is the same process in a browser.
   The fee is **99 USD a year**, auto-renewing; it is not per app.
4. **Wait for activation.** Usually a day or two. Apple may ask for a
   government photo ID; answering promptly is the difference between two days
   and two weeks.

No Mac is required at any point. EAS builds and signs in the cloud, and
`eas submit` uploads from Windows.

### Once the membership is active

```sh
cd apps/mobile
eas credentials -p ios          # EAS creates the distribution cert, profile and APNs key
eas build -p ios --profile production
eas submit -p ios --latest      # asks for the Apple ID and the App Store Connect app id
```

`iq.jibli.app` is already the bundle identifier and `ITSAppUsesNonExemptEncryption`
is already answered, so neither stops the first upload. The App Store Connect
app record has to exist first: **My Apps → +**, bundle id `iq.jibli.app`,
primary language Arabic, category Food & Drink.

`submit.production` in `eas.json` stays empty until there is an `ascAppId` and
an `appleTeamId` to put in it. `eas submit` prompts for both and offers to
write them, which is the moment to let it.

### What will fail review, and is failing now

- **The privacy policy URL does not resolve.** `extra.privacyPolicyUrl` points
  at `https://jibli.iq/privacy` and `jibli.iq` has no DNS at all — verified
  again on 2026-09-18. Apple requires a working privacy URL on the listing, and
  «سياسة الخصوصية» in حسابي opens the same dead link from inside the app, which
  is a 1.5 as well as a 2.1. Either put DNS on `jibli.iq` and deploy
  `apps/legal` behind it, or point `EXPO_PUBLIC_PRIVACY_URL` and
  `EXPO_PUBLIC_TERMS_URL` at the Vercel URL that app gets — but they must
  resolve before the build that is submitted, because the URL is baked in.
- **The API sleeps.** Render's free plan idles out after about fifteen minutes
  and takes a minute to wake. A reviewer opening a cold app sees a blank list
  or an error, and that is 2.1. Move `jibli-api` off the free plan for the
  review window at minimum.
- **The reviewer must be able to sign in, and right now they cannot.** App
  Review sits outside Iraq and cannot receive an Iraqi SMS. The fixed-code
  number that solved this is gone, so pick one of these before submitting and
  say which in the review notes:

  1. **A real Iraqi number somebody can read codes from** during the review
     window — a handset on a desk. Simplest, and nothing in the platform
     changes.
  2. **A password on a pre-made account.** Customers can now sign in with
     `POST /auth/password/login`, which needs no SMS at all, so an account
     created in advance with a known password lets a reviewer in from
     anywhere. This is the cleanest answer and it did not exist before.
  3. **Put `OTP_TEST_PHONES` and `OTP_MOCK_CODE` back for the review window
     only**, then remove them again. The env schema forbids them once
     `APP_ENV=production`, so this also pins the order of those two changes.

## Still a form

Nothing below is code. All of it is filled in by a person, and a wrong answer
here is a common rejection.

### App Store Connect

- **App Privacy.** Declare what is collected and why. Jibli collects a phone
  number, a name, a delivery area and optionally a coordinate, plus order
  history — all "linked to the user", none for tracking. There is no
  advertising SDK and no third-party analytics, so **App Tracking Transparency
  does not apply** and no `NSUserTrackingUsageDescription` should be added.
- **Age rating.** No objectionable content; food delivery is 4+.
- **Demo account.** Review needs one that works from anywhere. Since customers
  can sign in with a password, the simplest is an account created in advance
  with a known number and password — no SMS, no timezone problem. Say in the
  review notes which method it is, because a reviewer who cannot sign in
  rejects on 2.1 without asking.
- **Review notes.** State that the service operates in Iraq only, and that
  restaurants and coverage are set per-city, so an empty list outside a covered
  area is the product working.

### Google Play Console

- **Data safety.** Must agree with the App Privacy answers above. A mismatch
  between the two stores is not checked by either, but a mismatch between this
  form and observed behaviour is.
- **Account deletion URL.** Play requires a **web** page for deletion requests
  in addition to the in-app flow. The in-app flow exists; the page does not.
- **Target API.** Confirm the upload reports 36. It is refused at upload, not
  at review.
- **Data deletion and privacy policy URLs** must resolve publicly before
  submission — the same URLs `extra.privacyPolicyUrl` / `extra.termsUrl` point
  at.

## Before each submission

```sh
pnpm deploy:check        # typecheck, lint, tests, builds, mobile bundle
cd apps/mobile && npx expo-doctor@latest
```

`expo-doctor` should report all checks passing. It catches SDK/package drift
that typechecking cannot see — a package one minor behind its SDK will build
locally and fail on EAS.

Bump `version` in `app.config.ts`. Build numbers are EAS's to increment.

## What is not covered

Driver Mode ships in this binary as a customer-facing application form, not as
a delivery app — there is no background location and no live tracking
(ADR-0005). If that changes, both stores treat background location as the
hardest permission to justify, and it needs its own purpose strings, its own
Data safety answers, and on Play a separate declaration form.
