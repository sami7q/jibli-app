# Localized Info.plist strings — iOS only

Expo feeds these to `ios.locales`, which writes one `<lang>.lproj/InfoPlist.strings`
per file. iOS then picks the file matching the phone's language and falls back to
`CFBundleDisplayName` in `app.config.ts` for a language with no file here.

What that buys, and what it does not:

**It localizes the home-screen name.** A phone set to English shows «Jibli»;
everything else shows «جيبلي». That is the whole reason this directory exists —
`name` in `app.config.ts` is a single string and cannot be two things at once.

**It does not touch Android.** `@expo/config-plugins` calls
`getResolvedLocalesAsync(projectRoot, locales, 'ios')` with the platform pinned,
so Android takes `name` and nothing else. Localizing the Android label needs a
config plugin writing `res/values-en/strings.xml`, which is a dependency to
maintain across SDK upgrades in exchange for a label most Iraqi users will never
see. Android stays «جيبلي» on purpose.

**It is not the App Store listing name.** That is set per-locale in App Store
Connect and Play Console, it is what store search actually ranks, and it holds
both scripts at once — see `docs/operations/store-submission.md`.

The permission string is repeated here because a purpose string shown in the
phone's language is the point of the prompt; the Arabic copy in `app.config.ts`
remains the default for every locale without a file.
