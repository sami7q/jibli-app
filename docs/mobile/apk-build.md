# Building an APK you can install on a phone

For trying the app on a real handset, against the live API, without going near
Google Play or the App Store.

## Why EAS rather than a local build

`expo run:android` compiles on your own machine and needs Android Studio, a
JDK and the Android SDK installed and on PATH — an afternoon of setup on
Windows before the first build even starts. EAS builds on Expo's machines and
hands back a download link. The free tier is enough for this: it queues behind
paid builds, so a build takes roughly ten to twenty minutes rather than two.

Neither path involves a store. An APK built this way is installed by opening
the link on the phone and allowing "install from unknown sources" once.

## Before anything: you may not need this at all

If the goal is «أريد أجرب التطبيق على هاتفي وهو شغّال أونلاين», **Expo Go is
faster and needs no account and no build**. From the repository root:

```powershell
pnpm dev:mobile
```

Scan the QR code with Expo Go (Android) or the Camera app (iOS) and the app
opens on the phone, pointed at the deployed API. Every dependency this app uses
is in the standard Expo SDK 54 set, so nothing here needs a custom binary.
See `running-the-app.md`.

Build an APK instead when you want a file to hand to somebody else, an icon on
the home screen, or the app running with no laptop on the network.

## One-time setup

### 0. Create the Expo account first

`eas login` signs in to an account that must already exist — it does not create
one, and a username from GitHub or anywhere else will not work. The error is
just `Your username, email, or password was incorrect`, which reads like a typo
rather than like an account that was never created.

Sign up at **https://expo.dev/signup** (free), confirm the email, then use
those credentials below.

**One command per line.** This project is developed on Windows PowerShell 5.1,
which has no `&&` — a chained command line fails to parse and *nothing in it
runs*, including the first command. The symptom is confusing, because the next
thing you try then fails with "'eas' is not recognized": not a broken install, an
install that never happened.

```powershell
npm install -g eas-cli
eas login
cd apps\mobile
eas build:configure
```

`eas login` wants a free Expo account. `eas build:configure` is the only step
that changes a file, and it only adds the project id tying this checkout to that
account. `eas.json` is already committed.

## Every build after that

From anywhere in the repository:

```powershell
pnpm --filter @jibli/mobile apk
```

That is `eas build --platform android --profile preview`: an **APK**, marked
`internal` distribution, so EAS gives you a link and a QR code instead of
preparing a store upload. Open the link on the phone and install.

The `preview` profile pins `EXPO_PUBLIC_API_URL` to the deployed API, so the
build talks to the same backend the Admin portal does. Nothing else has to be
configured for it to work over mobile data.

## What "works online" depends on

  - **The API sleeps.** It runs on a free Render instance that spins down after
    fifteen minutes idle, and the first request then waits about a minute. The
    app shows its own loading state rather than failing, but a tester who opens
    the app cold should be told to expect it once.
  - **Sign-in needs an SMS provider.** `OTP_PROVIDER=console` on the deployed
    API means no real message is ever sent. The one number in `OTP_TEST_PHONES`
    signs in with the code in `OTP_MOCK_CODE`; every other number receives a
    code nobody can read. See `render.yaml` — OTPIQ is tested and needs only an
    account and five environment variables.
  - **Map tiles.** `EXPO_PUBLIC_MAP_TILE_URL` is unset, so the address picker
    falls back to OpenStreetMap's donated tile server. Fine for your own
    testing; its usage policy does not allow it for an app handed to other
    people. MapTiler's free tier covers far more than this needs.

## iOS

The same profile builds for iOS (`--platform ios`), but installing it on a
device without the App Store needs an Apple Developer account and the device
registered for ad-hoc distribution. Android is the path that works with no
paid account.
