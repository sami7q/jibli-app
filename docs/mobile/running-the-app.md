# Running the customer app

**Written for:** whoever needs the app on a screen today — you, a tester, or a
developer joining the project.

Everything below was executed against this repository and the deployed API on
2026-09-13; where something is verified, the evidence is named.

---

## 1. What you need once

```bash
pnpm install            # from the repo root
```

Then a way to see the app. Pick one:

| | What it runs | Needs | Good for |
|---|---|---|---|
| **Expo Go** | JavaScript only, inside Expo's own app | a phone + the Expo Go app from the store | seeing screens today |
| **Development build** | a real Jibli binary on your device | Xcode (iOS) or Android Studio | anything native — push, the real icon, store testing |

Expo Go is the fast path and is enough for everything the app currently does.

---

## 2. The fast path

```bash
pnpm dev:mobile
```

That starts Metro and prints a QR code. Scan it with the **Camera** app on iOS
or with **Expo Go** on Android, and the app opens on your phone.

The app points at the deployed API by default — `https://jibli-api.onrender.com`
— so it reads the real categories, banners and restaurants that Admin manages,
with no further setup. §7 says what that amounts to today.

**Pick a delivery area on first launch.** Browse as a guest, tap the location
row in the header, and choose بغداد. Nothing appears before that, by design:
`GET /restaurants` is scoped to one city and the app has no way to guess it.

> **First request is slow.** The API runs on Render's free plan, which spins
> down after 15 minutes idle and takes about a minute to wake. A measured cold
> start was **12.5 seconds**. The app's loading states handle it, but the first
> screen after a quiet period will sit there. This is a hosting plan, not a bug,
> and `render.yaml` says so.

### Pointing it somewhere else

```bash
# Windows PowerShell
$env:EXPO_PUBLIC_API_URL = "http://192.168.1.20:4000"; pnpm dev:mobile

# bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:4000 pnpm dev:mobile
```

**Never `localhost`.** A phone's `localhost` is the phone. Use the machine's
address on your network — `ipconfig` on Windows, `ifconfig` on macOS — and make
sure the API is listening on `0.0.0.0`, not `127.0.0.1`.

The value is read when the config is evaluated, so **restart Metro after
changing it**; it is baked into the app, not looked up per request.

---

## 3. Signing in

This is the one part that is not self-service, and the reason is deliberate.

`OTP_PROVIDER=console` in `render.yaml`: the deployed API has no SMS gateway,
so no real number can receive a code.

**One number can sign in, and it is the one to test with.** `OTP_TEST_PHONES`
names it and `OTP_MOCK_CODE` fixes its code, so it needs no SMS at all:

| | |
|---|---|
| Phone | `07712345678` (`+9647712345678`) |
| Code | `1234` |

Verified against the deployed API on 2026-09-15: `POST /auth/otp/request` for
that number answers `{"sent":true,...,"dev_code":"1234"}`. Every other number
still gets a random code delivered to a provider that only logs that a message
went out — never the code — so this opens exactly one account rather than the
URL.

That is enough to place a real order end to end on a phone. Replace it with a
real gateway before a real customer: see the OTPIQ block in `render.yaml`,
which is tested and needs an account and five environment variables.

Three ways forward, in order of how much you need:

**a. Don't sign in.** Browsing, search, categories, restaurant pages, full
menus and the cart all work signed-out. This is what guest mode bought, and it
is enough to review almost every screen.

**b. Run the API locally.** Then `APP_ENV=local` returns the code in the
response, the sign-in screen grows a one-tap «دخول سريع» button (§11), and the
OTP screen shows the code with a "tap to fill" button:

```bash
pnpm infra:up                               # Postgres + Redis in Docker
pnpm db:migrate && pnpm db:seed
pnpm dev:api                                # listens on 0.0.0.0:4000
EXPO_PUBLIC_API_URL=http://<your-lan-ip>:4000 pnpm dev:mobile
```

**c. Wire a real SMS provider** for staging. That is the only path that makes
the deployed app signable-into by a normal person, and it is required before
any real customer.

---

## 4. A real binary

```bash
pnpm --filter @jibli/mobile ios       # macOS + Xcode
pnpm --filter @jibli/mobile android   # Android Studio
```

The first run generates the native projects and takes several minutes. Needed
for push notifications, the app icon, and anything you intend to submit.

---

## 5. Checking it builds without a device

```bash
pnpm --filter @jibli/mobile bundle
```

Runs Metro over both platforms and writes `.expo-export/`. It is part of
`pnpm deploy:check` now, and it is there because **a typecheck cannot see this
class of failure**: before this change the app typechecked cleanly and could not
bundle at all — three separate reasons, none visible to `tsc`.

| What was wrong | Why `tsc` could not see it |
|---|---|
| `@babel/runtime` was not a dependency | it is injected by the Babel preset, not imported in source |
| `tsconfig`'s `react` path mapping was applied by Metro to *runtime* resolution, so `import 'react'` resolved to `@types/react` — a package with no JavaScript | the mapping exists precisely to make `tsc` happy |
| workspace packages import `./arabic.js` while the file on disk is `arabic.ts` | TypeScript resolves those itself; bundlers must be told |

Fixed by, respectively: a direct dependency, `experiments.tsconfigPaths: false`
plus a Babel alias for `@/`, and a Metro resolver that retries `.js` as `.ts`.
Both platforms bundle: **1224 modules (iOS), 1220 (Android)**.

---

## 6. Troubleshooting

| What you see | What it is |
|---|---|
| First load hangs ~1 min, then works | Render cold start. §2. |
| "تعذّر الاتصال بالإنترنت" on every screen | `EXPO_PUBLIC_API_URL` points at `localhost`, or the local API binds `127.0.0.1`. §2. |
| The app opens on a welcome screen, not the home | Correct. First launch asks once: sign in, or browse as a guest. |
| Home says «اختر منطقتك» and lists nothing | No delivery area chosen yet. Tap the location row in the header. If an area is chosen and the list is still empty, see §8. |
| Sign-in never arrives | No SMS gateway on staging. §3. |
| Metro cannot resolve a module after pulling | `pnpm install`, then `pnpm dev:mobile --clear`. |
| `CommandError: No Android connected device found` | You pressed **a** with no device or emulator attached. Nothing is wrong: scan the QR with Expo Go instead, or press **w** for the browser (§9). An emulator needs Android Studio. |
| Expo warns a package version is wrong | `pnpm --filter @jibli/mobile exec expo install --fix`, then restart Metro. Worth doing: `expo-splash-screen` was once pinned to a version from a *later* SDK, whose native API differs. |
| Arabic renders left-to-right on a fresh install | RTL is forced at startup and Android applies it after one restart. Close and reopen. |

---

## 7. What you will actually see today

Fetched live from the deployed API, so this is what the app renders right now:

| Part of the home screen | State |
|---|---|
| Category strip | **22 categories**, Arabic names, emoji — from Admin → التصنيفات. None has an image, so each falls back to its emoji. That is not a gap: the emoji are sharper than any placeholder that could be drawn for them, and a category image uploaded in Admin replaces one without a release. |
| Banner carousel | **3 banners**, with art, rotating every 5 seconds — all of it from Admin → شكل التطبيق. Two of them link to a category. |
| Restaurant list | **6 restaurants in بغداد**, each with a generated cover and logo. See below. |

Those strings exist nowhere in the app. They came out of the database Admin
writes to, which is what "connected" means here.

---

## 8. The demo marketplace

`pnpm --filter @jibli/db seed` creates six restaurants in بغداد whenever
`APP_ENV` is not `production`. They are not six of the same thing: each one
exists to make a different state of the app reachable.

| Restaurant | What it proves |
|---|---|
| **مندي حضرموت** | The full path. Open around the clock, 10 dishes in 3 categories, a **required** option group (الحجم) and an optional one (إضافات) — so the item sheet's "you must choose a size" rule is testable at any hour. |
| **برجر بغداد** | Free delivery. The card shows «توصيل مجاني» and the cart shows «التوصيل مجاني» instead of a fee. Also open around the clock. |
| **شاورما الأصيل** | No ratings yet, so the card must show «جديد» rather than a fake `0.0`. Opens 09:00 and closes at 02:00 the next morning — the overnight wrap. |
| **بيتزا روما** | Three option sizes with different prices. Closed outside 12:00–23:00. |
| **حلويات أبو عفيف** | Closed most of the day (08:00–16:00, shut on Friday), which is how the «مغلق الآن» overlay and the faded menu get exercised. |
| **مشاوي الخيمة** | A 25,000 IQD minimum, so the cart's "add 12,000 more" warning is reachable. Two items marked unavailable. |

**45 menu items, 15 categories, 8 option groups**, and one unavailable dish per
restaurant where it makes sense — because an item that is out of stock today has
to grey out rather than disappear.

**And 15 generated images**: a cover and a logo per restaurant, plus three
banners. Drawn rather than photographed — a stock photograph in a repository is
a licensing question nobody wants — and each restaurant's is the brand orange
turned a fixed number of degrees around the wheel, so six covers look like six
restaurants without inventing a second palette. They go through the same
pipeline an upload does: a row in `assets`, bytes in `asset_bytes`, served by
`GET /api/v1/assets/:id`. The day a restaurant uploads its own, these disappear.

The hue range is deliberately narrow — red through orange to amber. The first
attempt used ±45° and the shawarma restaurant came out yellow-green, which is
the colour of nothing anybody wants to eat.

Re-running the seed changes nothing: it is idempotent on `partner_code`. A
second run reports `0 inserted, 6 updated`.

### Restaurant portal accounts

Each demo restaurant has an owner who can sign into the restaurant portal:

| Username | Password | Restaurant |
|---|---|---|
| `demo.mandi` | `Jibli!Demo2026` | مندي حضرموت |
| `demo.burger` | `Jibli!Demo2026` | برجر بغداد |
| `demo.pizza` | `Jibli!Demo2026` | بيتزا روما |
| `demo.shawarma` | `Jibli!Demo2026` | شاورما الأصيل |
| `demo.sweets` | `Jibli!Demo2026` | حلويات أبو عفيف |
| `demo.grill` | `Jibli!Demo2026` | مشاوي الخيمة |

Demo credentials, printed in the seed output and stated here on purpose. They
belong to fake restaurants and must not exist in production — the seeder
refuses to run when `APP_ENV=production`.

### Geography

The seed also opens **بغداد** for signup, onboarding and ordering. Before it
ran, the only ordering-enabled area was حديثة in الأنبار and it had no
restaurants, so the app showed an empty list — indistinguishable from a broken
one. `GET /restaurants` requires the city *and* its governorate to be enabled
for ordering, the restaurant `APPROVED` and `ACTIVE`, and the branch active and
accepting orders. Any one of those being off yields `[]`.

---

## 9. Seeing the screens without a phone

Two terminals:

```bash
pnpm --filter @jibli/mobile proxy      # terminal 1
pnpm --filter @jibli/mobile web        # terminal 2
```

Then open **http://localhost:4010** — not 8081. The proxy serves a phone frame
that renders the app at a real device size with a size picker (iPhone SE
through Pro Max), because a layout reviewed across a 1900px desktop window is
not the layout anyone will use. 8081 still works if you want it full-width.

This runs the same app through React Native Web. Both terminals are needed, and
each solves a problem that only exists in a browser:

- **The proxy exists because of CORS.** A phone is a native client: it sends no
  `Origin` header, and the API's CORS callback admits exactly that. Chrome sends
  `Origin: http://localhost:8081`, which is not on the allowlist, so without the
  proxy every request fails and every screen renders empty. The proxy is
  development-only; nothing like it exists in production, and the production
  allowlist was not widened to include a laptop.
- **RTL is handled.** `I18nManager.forceRTL` is a no-op on web, so `enforceRtl()`
  sets `dir="rtl"` on the document as well. Without it the preview would lay out
  left-to-right and every header would look mirrored from what a device shows.
- **Sessions fall back to `localStorage`.** `expo-secure-store` ships literally
  `export default {}` for web, so `setItemAsync` is not a function there and
  every sign-in died on «حدث خطأ غير متوقع» — the preview could show every
  screen and complete nothing. `secure-session.ts` branches on
  `Platform.OS === 'web'`. The fallback is genuinely worse — readable by any
  script on the origin, not encrypted at rest — which is why it is a web-only
  branch and the app is never shipped to the web.

It is a review tool, not a target — React Native Web is a different renderer, so
fonts, safe areas and gestures are all approximations. But it earns its keep:
six real defects were found this way — English cuisine keys leaking into Arabic
cards, a blank grey block where a restaurant has no cover photo, text glyphs
standing in for icons, category names truncated mid-word, badges on the wrong
edge under RTL, and a sign-in button disabled for a reason that had nothing to
do with signing in.

---

## 10. What is real, and what is not

Three integrations get asked about, so they are written down plainly.

| | State |
|---|---|
| **OTP / SMS** | The gateway is **implemented** — `HttpSmsGatewayProvider`, with one retry on a 5xx or a timeout, never on a rejection, and the body never logged. It is **not connected**: set `OTP_PROVIDER=sms_gateway`, `SMS_GATEWAY_URL` and `SMS_GATEWAY_API_KEY` and sign-in works. Field names differ by aggregator and are configuration (`SMS_GATEWAY_TO_FIELD` and friends); `SMS_GATEWAY_AUTH_SCHEME` chooses bearer, header or body. On staging, set `OTP_PHONE_ALLOWLIST` so a live gateway cannot text a real customer. |
| **Signing in without SMS** | `OTP_PROVIDER=mock` makes the code a fixed one — `OTP_MOCK_CODE`, default `0000` — so **any number signs in**. It replaces the generated code rather than bypassing verification, so the challenge is still stored, hashed, expired, attempt-counted and rate-limited exactly as in production; only the randomness is gone. Right on a laptop, too wide for a URL anyone can reach — so `OTP_TEST_PHONES` is the same mechanism narrowed to a comma-separated list: those numbers get the fixed code and get it back in the response, every other number keeps a random one it cannot read. Listed numbers also skip the gateway, so connecting a real one later cannot start billing for them. The schema refuses both `mock` and a non-empty `OTP_TEST_PHONES` in production, so neither can escape. |
| **Google sign-in** | **Server: done.** `POST /auth/google` verifies the ID token against Google's published keys, checking issuer, audience and expiry, and matches on Google's subject id rather than the email — an email can change hands, a subject cannot. A Google account is signed in but **cannot order**: `assertPhoneVerified` refuses the quote and the order until a phone is linked through `POST /auth/phone/link`, which runs the same OTP with the same limits. **App: ready but off.** Fill in `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID` and set `GOOGLE_CLIENT_IDS` on the server; without them the button is hidden, because a Google button that fails is worse than none. **Shipping it on iOS obliges Sign in with Apple beside it** (guideline 4.8) — that work is not done. |
| **Maps** | There is **no in-app map**, deliberately. What exists: the customer can attach their current coordinates to a saved address (`expo-location`, foreground only, asked once), and any point can be opened in whatever maps app the phone already has — `geo:` on Android, Apple Maps on iOS, a Google Maps URL as the fallback. None of that needs an API key or a billing account. A rendered map would need a map SDK, a key, and a geocoder, and in a city where addresses are landmarks it would still be «قرب صيدلية النور» that gets the driver there. ADR-0005 stands: no live driver tracking. |
| **Driver sign-up** | **Now exists.** `POST /api/v1/driver/apply` creates a driver in `PENDING_ACTIVATION`; `GET /api/v1/driver/application` reports its state. In the app it is a row on the account screen — visible to guests too, because somebody who wants to deliver arrives as a browsing customer. Applying is not joining: an operator activates the account, and `assertDriver` refuses everything until they do. |

---

## 11. Running the API locally, and a test account

The deployed API has no SMS gateway, so a random code goes to a console
provider and is never seen — which for a while meant nobody could sign into the
deployed app at all. `OTP_TEST_PHONES` on the Render service now opens exactly
one number, the demo account below, with `OTP_MOCK_CODE=1234`. **Signing in
against the deployed API needs nothing running locally**: start the proxy and
the web preview, enter `771 234 5678`, code `1234`.

Its first request may take up to a minute. Render's free plan spins the service
down after fifteen minutes idle, and the proxy now waits out that cold start
instead of failing — it prints `waking it, this takes up to a minute…` and
retries until the service answers.

Run the API yourself when you need anything the deployed one will not do: sign
in as a *second* number, raise the OTP limits, read server logs, or work
against your own database.

### No Docker needed

```powershell
$env:DATABASE_URL       = "<the Neon pooled URL>"
$env:APP_ENV            = "local"
$env:REDIS_URL          = "memory://local"
$env:OTP_PROVIDER       = "mock"
$env:OTP_MOCK_CODE      = "1234"
$env:API_HOST           = "0.0.0.0"
# Reviewing the app means signing in dozens of times an hour, and the
# production limits (5/hour per number) lock you out of your own preview
# after five taps. The limits exist to protect the SMS budget; the mock
# provider sends no SMS. Local only — the defaults are what ship.
$env:OTP_RESEND_COOLDOWN_SECONDS = "15"
$env:OTP_MAX_PER_PHONE_HOUR      = "500"
$env:OTP_MAX_PER_PHONE_DAY       = "2000"
$env:OTP_MAX_PER_IP_HOUR         = "2000"
$env:JWT_ACCESS_SECRET  = "<any 32+ characters>"
$env:JWT_REFRESH_SECRET = "<any other 32+ characters>"
$env:OTP_HASH_PEPPER    = "<any 32+ characters>"
pnpm --filter @jibli/api dev
```

`memory://local` runs an in-process Redis substitute, so the API starts with no
Docker and no Redis. It is **refused in production** by the env schema: counters
that live in one process and vanish on restart are not rate limiting, and a
publish that reaches one instance is not realtime.

`OTP_PROVIDER=mock` makes the code a fixed `1234` for **any** number. It
replaces the generated code rather than bypassing verification, so expiry,
attempt counting and rate limits all behave exactly as in production — and it
is refused in production too.

**The raised OTP limits are the only values here that differ from production,
and they are worth understanding before copying them anywhere else.** The
defaults are five sends per number per hour; reviewing the app means signing in
far more often than that, and the sixth tap locks you out of your own preview
until the hour rolls over. The limits exist to protect the SMS budget and to
make number enumeration expensive — neither applies when the provider sends no
SMS. **Set them only on a local server.** The app also keeps the last code it
was given and reuses it when a request comes back rate-limited, so the shortcut
degrades into a no-op instead of an error; the refusal happens before the
service invalidates the outstanding challenge, so that code is still live.

Then point the app at it:

```powershell
pnpm --filter @jibli/mobile proxy     # terminal 2
pnpm --filter @jibli/mobile web       # terminal 3  → http://localhost:4010
```

The proxy finds the local API on its own — it probes `localhost:4000/health/live`
at startup and falls back to the deployed one — and prints which it chose, so a
preview talking to the wrong API says so in its first line rather than in a
confusing ten minutes. `JIBLI_PROXY_UPSTREAM` still overrides it; start the API
after the proxy and you have to restart the proxy, since the probe runs once.

For a phone over Expo Go, set `EXPO_PUBLIC_API_URL` to `http://<your LAN
ip>:4000` instead — never `localhost`, which on a phone is the phone.

### The test account

Sign in with **any** Iraqi number and the code **1234**. One account is set up
and ready to order from — profile completed, default address saved:

| | |
|---|---|
| Phone | `+964 771 234 5678` |
| Code | `1234` |
| Name | حساب تجريبي |
| Area | بغداد / بغداد |
| Address | الكرادة، شارع ٦٢، قرب صيدلية النور (default) |
| Order placed | `JB9505061` — بطاطا مقلية ×2, 5,000 + 500 service = **5,500** |

**One tap gets you in.** The sign-in screen carries a «دخول سريع — وضع
التطوير» button that requests the code for that number and submits it in the
same gesture, landing straight on the home screen. It is drawn only when
`__DEV__` is true *and* the server actually answers with a code — which it does
solely for `APP_ENV=local`, the mock provider, or a number in `OTP_TEST_PHONES`
— so there is no build in which a customer can see it and no flag to remember
to turn off. It works against the deployed API too, because the number it uses
is the listed one.

It goes through the real OTP path rather than around it: the challenge is
stored, hashed, expired, attempt-counted and rate-limited exactly as in
production. That is the point — a shortcut that skipped verification would
prove the flow works while never running it.

**Deleting it** is itself a test worth running: «حسابي» → «حذف حسابي». It will
refuse while the order is in flight — cancel the order first from «طلباتي» —
which is the guard doing its job, not a bug.

---

## 12. What is deployed, and where

| Piece | Where | Verified |
|---|---|---|
| API | Render `jibli-api`, Frankfurt | `/health/ready` → `{"status":"ok","checks":{"database":true,"redis":true}}` |
| Admin portal | Vercel | — |
| Restaurant portal | Vercel | — |
| Database | Neon PostgreSQL | reported healthy by the API |
| Redis / Key Value | Render | reported healthy by the API |
| Customer app | not published | bundles for both platforms; reviewed screen by screen in a browser; never run on a device |
| Demo marketplace | Neon, بغداد | 6 restaurants, 45 items, 8 option groups — §8 |

The worker (`jibli-worker`) is the one paid service in `render.yaml`. Without it
the portals still work — the order board falls back to polling — but the
transactional outbox is not published, so push notifications and live order
events do not flow.
