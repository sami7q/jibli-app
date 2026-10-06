# Localized app metadata — per platform

Each file is one language. Keys **must** sit under `"ios"` or `"android"`:

```json
{
  "ios": { "CFBundleDisplayName": "Jibli", "NSLocationWhenInUseUsageDescription": "…" },
  "android": { "app_name": "Jibli" }
}
```

**Never put a key at the top level.** `@expo/config-plugins` applies top-level
keys to _both_ platforms. This directory used to hold flat iOS keys on the
belief that Expo only read it for iOS — true once, not on SDK 57 — and Android
received `CFBundleDisplayName`, `CFBundleName` and
`NSLocationWhenInUseUsageDescription` as `res/values-b+<lang>/strings.xml`.
None of them exists in Android's default `strings.xml`, so release lint
(`lintVitalRelease`) failed the build with six `ExtraTranslation` errors.

The rule Android enforces: a string translated into a language must also exist
in the default locale. `app_name` does (Expo writes it from `name` in
`app.config.ts`), which is why it is the only Android key here.

What each platform gets:

- **iOS** — one `<lang>.lproj/InfoPlist.strings` per file: the home-screen name
  and the location permission text in the phone's language.
- **Android** — the launcher label: «Jibli» on an English phone, «جيبلي»
  everywhere else. The permission text is not localizable on Android; the OS
  writes its own prompt.

Neither is the store listing name. That is set per locale in App Store Connect
and Play Console — see `docs/operations/store-submission.md`.

To check a change without a build, generate the Android project and compare
keys: every `<string name>` in `values-*/strings.xml` must appear in
`values/strings.xml`. `npx expo prebuild --platform android --no-install`, then
delete `android/` — it is generated, not committed.
