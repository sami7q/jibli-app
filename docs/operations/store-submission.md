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
- **Keep `OTP_TEST_PHONES` until review is over.** It is how App Review signs
  in without an Iraqi number, and the env schema forbids it in production, so
  it has to go before `APP_ENV` moves.

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

### EAS is not linked

`eas-cli` is logged in on the build machine, but `app.config.ts` carries no
`extra.eas.projectId`, so `eas init` has never run. `eas.json` already has both
profiles — `preview` builds an APK for internal testing, `production` an AAB —
and `submit.production` is empty and needs the App Store Connect app id and a
Play service-account key.

### Smaller

- `assets/adaptive-icon.png` is 432×432. Android wants 1024×1024; it works at
  432 but is soft on large launchers.
- A new **personal** Play developer account must run a closed test with a dozen
  testers opted in continuously for two weeks before production access can even
  be requested. It is the longest item on the calendar and it runs in parallel
  with everything else, so open the account and start the test first. Confirm
  the current numbers in the Play Console — this rule has been revised before.

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
- **Demo account.** Review needs one that works from anywhere. Give them a real
  number they can receive codes on, or `OTP_TEST_PHONES` with its fixed code —
  and say in the review notes which it is, because a reviewer who cannot sign
  in rejects on 2.1 without asking.
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
