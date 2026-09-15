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
