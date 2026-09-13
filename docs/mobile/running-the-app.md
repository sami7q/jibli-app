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
with no further setup. What that amounts to *today* is in §7; the short version
is that the categories are there and the restaurant list is empty for a reason
that is a setting, not a bug.

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

`OTP_PROVIDER=console` in `render.yaml`: the deployed API has no SMS gateway.
It also runs with `APP_ENV=staging`, and the OTP is returned to the client
**only** when `APP_ENV=local` (`otp-service.ts`) and logged **only** when the
same is true (`ConsoleSmsProvider`). So against the deployed API nobody can
complete a sign-in — by design, because the alternative is an OTP in a log file.

Three ways forward, in order of how much you need:

**a. Don't sign in.** Browsing, search, categories, restaurant pages, full
menus and the cart all work signed-out. This is what guest mode bought, and it
is enough to review almost every screen.

**b. Run the API locally.** Then `APP_ENV=local` returns the code in the
response and the OTP screen shows it with a "tap to fill" button:

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
| Home says «اختر منطقتك» and lists nothing | No delivery area chosen yet, or the chosen area has no restaurants. §8 below. |
| Sign-in never arrives | No SMS gateway on staging. §3. |
| Metro cannot resolve a module after pulling | `pnpm install`, then `pnpm dev:mobile --clear`. |
| Arabic renders left-to-right on a fresh install | RTL is forced at startup and Android applies it after one restart. Close and reopen. |

---

## 7. What you will actually see today

Fetched live from the deployed API, so this is what the app renders right now:

| Part of the home screen | State | Why |
|---|---|---|
| Category strip | **22 categories**, Arabic names, emoji | Admin → التصنيفات, already populated. None has an image yet, so each falls back to its emoji — which is the designed fallback, not a gap. |
| Banner carousel | **hidden** | `banners: []`. The carousel renders nothing rather than an empty box. Add one in Admin → شكل التطبيق and it appears on the next launch. |
| Rotation speed | 5 seconds | Admin's value, already being read. |
| Restaurant list | **empty** | §8. This one is a configuration problem worth fixing. |

The first three prove the link end to end: those strings exist nowhere in the
app, they came out of the database that Admin writes to.

---

## 8. Why the restaurant list is empty — and it is not the app

Checked live against the deployed API:

```
GET /api/v1/geography/governorates?capability=ordering
  → 1 governorate:  الأنبار
GET /api/v1/geography/governorates/<الأنبار>/cities?capability=ordering
  → 1 city:  حديثة
GET /api/v1/restaurants?city_id=<حديثة>
  → []
```

So the only area open for ordering has no restaurants in it, and **بغداد has no
enabled cities at all** under either capability.

`GET /restaurants` requires, all at once: the city enabled *and* ordering-enabled,
its governorate the same, the restaurant `APPROVED` and `ACTIVE`, and its branch
active and accepting orders. Any one of those being off yields an empty list,
which is the same thing the app shows when everything is fine and the area is
genuinely empty.

**To make the app show something**, in Admin → المناطق:

1. Enable **بغداد** for `ordering` (not only `customer_signup`).
2. Add or enable at least one **city** in بغداد, with ordering enabled.
3. Confirm the restaurant's branch sits in that city, is active, and accepts
   orders.

Geography is checked twice on purpose — once on the governorate and once on the
city — so a governorate can be opened for signup before it is ready to take
orders. That is the state the platform is in right now.

---

## 9. What is deployed, and where

| Piece | Where | Verified |
|---|---|---|
| API | Render `jibli-api`, Frankfurt | `/health/ready` → `{"status":"ok","checks":{"database":true,"redis":true}}` |
| Admin portal | Vercel | — |
| Restaurant portal | Vercel | — |
| Database | Neon PostgreSQL | reported healthy by the API |
| Redis / Key Value | Render | reported healthy by the API |
| Customer app | not published | bundles for both platforms; never run on a device |

The worker (`jibli-worker`) is the one paid service in `render.yaml`. Without it
the portals still work — the order board falls back to polling — but the
transactional outbox is not published, so push notifications and live order
events do not flow.
