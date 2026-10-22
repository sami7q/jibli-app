# Launch checklist — from this commit to both stores

The order to do things in, as of 16 October 2026. Everything in the code is
done and tested; what is left is accounts, dashboards and one push. Each step
names the document with the detail.

## 0. What the push carries

One `git push origin main` takes every local commit. With the `buildFilter`
in `render.yaml` it is the last push that has to rebuild the API for a
mobile-, docs- or legal-only change.

On that push, Render:

- syncs the Blueprint: `jibli-api` moves to the paid `0.5c-512mb` plan
  (always on) and both services get the build filter;
- builds the API and runs migration **0024** on boot: the twelve sample shops
  are suspended (hidden, no orders, invented ratings dropped) and every
  sample owner login is switched off.

Vercel rebuilds the legal site (contact address now configurable).

After it: `/health/live` and `/health/ready` 200, and a guest browsing
Haditha (the only enabled city) sees the review market and nothing else.

## 1. Before building

| #   | Where                                    | What                                                                                                                                                                        |
| --- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Admin portal                             | Orders on the sample shops: anything still open (PENDING_RESTAURANT and later) was placed by somebody real — cancel it and, if a phone is on it, tell them.                 |
| 2   | Vercel → legal project → Environment     | `NEXT_PUBLIC_CONTACT_EMAIL` = a mailbox that is read; optional `NEXT_PUBLIC_SUPPORT_PHONE`. Redeploy. `privacy@jibli.iq` does not exist.                                    |
| 3   | Admin → شكل التطبيق                      | The one live banner is titled «لللل» (screen readers say it) and its artwork says «أطلب الآن» with no link; give it a real title and a category link, or replace it.        |
| 4   | Firebase                                 | Android app `iq.jibli.app` → `google-services.json` (EAS file variable `GOOGLE_SERVICES_JSON`, production) and an FCM V1 service-account key (EAS → Credentials → Android). |
| 5   | EAS → Environment variables (production) | `EXPO_PUBLIC_SUPPORT_PHONE` = the real +964 number. No `EXPO_PUBLIC_GOOGLE_*`.                                                                                              |
| 6   | Apple                                    | `eas credentials -p ios` (certificate, profile, APNs key); App Store Connect app record — `app-store-review-access.md`.                                                     |
| 7   | Render → jibli-api / jibli-worker        | `DATABASE_SSL=true`, `CORS_ALLOWED_ORIGINS` without localhost, `OTP_TEST_PHONES` empty, then `APP_ENV=production` on **both**. `store-submission.md`, `render.yaml`.        |
| 8   | Production DB, from a laptop             | `pnpm review:provision` (renames the review customer to «حساب المراجعة») and switch `GOOGLE_PLAY_REVIEW_*` on. `google-play-review-access.md`.                              |

## 2. Build and test

```sh
cd apps/mobile
pnpm release:check
eas build --platform android --profile production
eas build --platform ios --profile production
```

Install from Play internal testing and TestFlight, on a phone that has never
had the app (the first launch must already be right-to-left):

- guest browse → sign in with the review number at checkout → address → map pin
  (allow and deny location) → checkout screen;
- owner: sign in, add a product with a photo from the library **on an Android
  12 or older phone if one is available** and from the camera;
- courier: sign in, empty list;
- حسابي → support (on an iPad: WhatsApp/browser), privacy, terms;
- push with the app closed, on both platforms;
- delete a throwaway customer account.

## 3. Store forms and submission

- Play: Data safety and Advertising ID from `data-safety.md`; App access text
  from `google-play-review-access.md`; content rating; target audience 18+ or
  13+ (not children); account deletion URL.
- **A personal Play developer account cannot publish to production until a
  closed test has had 12 testers opted in for 14 consecutive days** (accounts
  created after 13 November 2023). Start the closed test as soon as the first
  AAB exists; it is the longest item on the calendar.
- Apple: App Privacy, age rating, review notes, screenshots —
  `app-store-review-access.md`.

## 4. Before real customers

- Onboard real shops. Until then the app shows only the review market, whose
  description tells customers it is a test shop.
- After approval: `pnpm review:provision -- --remove`, and unset
  `GOOGLE_PLAY_REVIEW_*`.
- Someone watches Admin → التقييمات → «طابور المراجعة» daily (the terms
  promise 24 hours).
- Two-factor on the Expo, GitHub, Render, Vercel, Apple and Google accounts;
  consider making the repository private.

## Known and accepted for release 1

- Shop-owner and staff accounts cannot be deleted from inside the app; the
  app tells them to contact support (`DELETE /api/v1/profile`). Customer
  deletion is complete in-app and on the web.
- `pnpm db:remove-demo --confirm` cannot delete a shop (branches reference it
  `ON DELETE RESTRICT`, so the transaction rolls back) and `--all` includes
  the review market. Migration 0024 replaces it for production; do not run it
  there.
- The camera cannot be opened on Android 9 and older (it needs the storage
  permission the manifest removes); choosing from the library works.
- `pnpm audit` reports critical/high findings in build and test tools only
  (vitest, vite, next's postcss, expo-cli's node-forge, metro's braces);
  nothing in the API image or the app bundle.
