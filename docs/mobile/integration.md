# How the app and the dashboards are connected

**Written for:** engineers changing either side of the boundary, and anyone who
needs to know whether a switch in Admin actually reaches a phone.

Every endpoint listed here was checked against the running server on
2026-09-13. Where something is verified live, the result is quoted.

---

## 1. The shape of it

```
   Admin portal ──┐                          ┌── Customer app (Expo / React Native)
                  │                          │      talks to the API directly
Restaurant portal ┤                          │      no proxy, no cookies
                  │                          │
                  └──► Fastify API ◄─────────┘
                         │   │
                         │   └── Redis   rate limits, realtime pub/sub
                         └────── Postgres  every invariant
```

The two portals and the app reach the same API and the same database. There is
no second backend, no duplicated business rule, and no synchronisation job
between them: a change in Admin is visible to the app on its next request
because they are reading the same rows.

**The portals and the app connect differently, and it matters.**

The portals proxy `/api/*` through their own Next.js origin
(`config/next-portal.mjs`). They must: a refresh cookie set by another host is
third-party to the browser and would not be sent, so every session would die at
page load. Proxying makes the cookie first-party and keeps the CSP at
`connect-src 'self'`.

The app has no such problem — it is not a browser, holds no cookies, and is not
subject to CORS — so it calls the API host directly with a bearer token. The
API's CORS callback allows requests carrying no `Origin` header, which is what a
native client sends:

```ts
// apps/api/src/server.ts
origin: (origin, callback) => {
  // Same-origin and native mobile requests send no Origin header.
  if (!origin) return callback(null, true);
  callback(null, allowedOrigins.includes(origin));
};
```

So `CORS_ALLOWED_ORIGINS` never needs a mobile entry, and adding one would mean
nothing.

---

## 2. Every call the app makes

24 distinct calls. Each was matched against the route table by script; **0
missing, 0 mismatched between what the client sends and what the route
requires.**

### Public — a guest reaches all of these

| Call                                                        | Route file      | What it is for                         |
| ----------------------------------------------------------- | --------------- | -------------------------------------- |
| `GET /api/v1/storefront`                                    | `storefront.ts` | banners, categories, rotation seconds  |
| `GET /api/v1/restaurants?city_id=`                          | `catalog.ts`    | the home list                          |
| `GET /api/v1/restaurants/:id`                               | `catalog.ts`    | detail + full menu                     |
| `GET /api/v1/catalog/items/:id/modifiers`                   | `catalog.ts`    | options, fetched when a dish is opened |
| `GET /api/v1/geography/governorates?capability=`            | `geography.ts`  | the area picker                        |
| `GET /api/v1/geography/governorates/:id/cities?capability=` | `geography.ts`  | the area picker                        |
| `GET /api/v1/assets/:id`                                    | `assets.ts`     | every image                            |
| `POST /api/v1/auth/otp/request` · `…/verify`                | `auth.ts`       | sign-in                                |

`GET /assets/:id` answers with `Cache-Control: public, max-age=31536000,
immutable`, which is correct rather than optimistic: the id is a UUIDv7 minted
per upload and never reused, so replacing a logo mints a new id. Images are
therefore fetched once per device, ever.

### Authenticated

| Call                                                             | Route file     | Notes                                       |
| ---------------------------------------------------------------- | -------------- | ------------------------------------------- |
| `GET /api/v1/auth/me`                                            | `auth.ts`      | identity **and the delivery area** — see §5 |
| `POST /api/v1/profile/complete` · `PATCH /api/v1/profile`        | `profile.ts`   | name, default area                          |
| `DELETE /api/v1/profile`                                         | `profile.ts`   | account deletion — App Store 5.1.1(v)       |
| `GET`/`POST /api/v1/addresses`                                   | `profile.ts`   | delivery addresses                          |
| `POST /api/v1/checkout/quote`                                    | `orders.ts`    | the authoritative total                     |
| `POST /api/v1/orders`                                            | `orders.ts`    | placement, with an idempotency key          |
| `GET /api/v1/orders` · `/:id` · `/:id/cancel`                    | `orders.ts`    | history, detail, cancellation               |
| `GET /api/v1/orders/:id/review-eligibility`                      | `reviews.ts`   | the 15-minute window                        |
| `GET /api/v1/reviews/pending` · `POST /api/v1/orders/:id/review` | `reviews.ts`   | rating                                      |
| `GET`/`PUT`/`DELETE /api/v1/favorites`                           | `favorites.ts` | the favourites tab                          |
| `POST /api/v1/devices`                                           | `profile.ts`   | push token                                  |

---

## 3. What the dashboards actually control

This is the answer to "is it connected": not "the app can reach the API", but
"this switch changes that pixel".

| Change this                                       | …in                             | The app shows it at                                                     | How                                         |
| ------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------- |
| Banner image, title, order                        | Admin → شكل التطبيق             | home carousel                                                           | `GET /storefront`                           |
| Banner rotation seconds                           | Admin → شكل التطبيق             | how fast the carousel advances                                          | same field, read by `BannerCarousel`        |
| Category names, emoji, images, order, visibility  | Admin → التصنيفات               | the category strip                                                      | `GET /storefront`                           |
| Enable/disable a governorate or city for ordering | Admin → المناطق                 | which areas the picker offers, and whether anything is orderable at all | `capability=ordering`                       |
| Approve / suspend a restaurant                    | Admin → المطاعم                 | whether it appears anywhere                                             | `onboarding_status`, `operational_status`   |
| Delivery fee, minimum order                       | Admin → restaurant detail       | the card, the cart, the quote                                           | `GET /restaurants`                          |
| Commission (500 IQD)                              | Admin → الإعدادات               | **nothing** — the customer never sees it                                | applied server-side at placement            |
| Working hours, busy mode                          | Restaurant portal               | «مفتوح الآن» / «مغلق الآن», the ETA                                     | computed server-side by `evaluateOpenState` |
| Menu items, prices, availability, options         | Restaurant portal → المنيو      | the whole restaurant screen                                             | `GET /restaurants/:id`                      |
| Accepting orders toggle                           | Restaurant portal               | whether the menu can be added to                                        | `orderable`                                 |
| Order status                                      | Restaurant portal → order board | the timeline on the order screen                                        | `GET /orders/:id`                           |
| Driver assignment                                 | dispatch                        | the driver card appears                                                 | `GET /orders/:id`                           |
| Rating window                                     | Admin → الإعدادات               | when «قيّم الطلب» becomes tappable                                      | `review-eligibility`                        |

**Nothing on the home screen is a constant in the app.** That is the whole
design: a Ramadan banner or a promoted category must not need a release,
because a release takes a week to reach every phone through two review queues.

**Open/closed is not the app's opinion.** `is_open`, `accepts_orders` and
`orderable` are computed on the server from the hours the restaurant keeps in
its own portal. The app renders the answer; it never derives it from a clock.

---

## 4. The practices this boundary is built on

Each of these exists because of a specific failure, and each is worth keeping.

**One envelope.** Every response is `{ data, meta }` or `{ error }`. The client
unwraps `data` once, in `apiRequest`, so no screen ever touches the envelope.

**Errors are Arabic at the source.** The server sends
`{ code, message, details, request_id }` with `message` already in Arabic,
because the server is the only party that knows whether this was a cooldown, a
rate limit or a delivery failure. The app shows `messageAr` rather than
inventing a generic string, and `request_id` is what support quotes.

**The server owns the total.** `POST /checkout/quote` runs the _same_ pricing
path as placement. Placement also takes `expected_total_iqd` — what the customer
was shown — and refuses with `PRICE_CHANGED` if it no longer matches. A customer
cannot be charged a number they did not agree to.

**Placement is idempotent.** The key is generated once when the checkout screen
mounts, held in a ref, and reused on every retry. A mobile network that times
out after the server committed must not produce a second order: the restaurant
would cook twice and the customer would pay twice.

**Refresh is single-flight.** Rotation is single-use: if three requests 401
together and each refreshes, the second presents an already-rotated token, the
server treats it as a replay and revokes the entire chain — signing the customer
out, usually mid-order. One refresh, shared. There is a test for exactly this.

**Tokens live in the keystore.** `expo-secure-store`, backed by iOS Keychain and
Android Keystore, with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` so they are excluded
from device backups. Never AsyncStorage.

**A dead connection is not a business answer.** `NetworkError` and `ApiError`
are separate types, because "the server refused this order" and "we never
reached the server" call for opposite handling — the second is resolved by
idempotency key, not treated as a failure.

**Read the auth model once:** every authenticated request re-checks the user row
(`deleted_at`, `status`) and the session row (`revoked_at`, `expires_at`). This
is why account deletion takes effect immediately on every device rather than
after the access token expires.

---

## 5. Three gaps that were closed to make this real

Found while wiring the screens; each was a break in the chain, not a missing
screen.

**`GET /auth/me` never returned the customer's city.** The mobile `Me` type
declared `city_id`, the server never sent it, and `GET /restaurants` requires
one — so the home screen's query was permanently disabled and **every signed-in
customer saw «أكمل ملفك أولاً» and zero restaurants**. The area now travels with
its Arabic names, so the header can show it without a second round trip.

**Favourites had a table since the first migration and no endpoints.** Three
routes now, returning the same card shape as discovery so the home screen and
the favourites tab render through one component and cannot disagree about what a
restaurant looks like.

**A guest has no profile to take a city from.** `GET /restaurants` needs one, so
the comp's location row became a real control: a guest picks an area and browses;
a signed-in customer's pick syncs back to their profile so it follows them to
another phone. The profile _seeds_ the local area and does not police it —
policing it made the picker useless, because every choice snapped back.

---

## 6. Where the app deliberately does less

|                                  | Why                                                                                                                                                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No WebSocket                     | The realtime gateway serves the restaurant board, where seconds matter. The order screen polls every 20s **only while the order is moving**, and stops at a terminal status; a delivered order never changes again, and polling one keeps a radio awake for nothing. |
| No live driver GPS               | ADR-0005. The order screen shows status and a driver card, not a map.                                                                                                                                                                                                |
| No in-app payment                | Food is a physical good, so App Store 3.1.1 does not apply and IAP must **not** be used. Cash on delivery is the only method.                                                                                                                                        |
| No social sign-in                | The login comp draws Google and Apple. Neither was built: there is no identity provider behind them, and adding one pulls in guideline 4.8, which would then oblige Sign in with Apple.                                                                              |
| No camera or location permission | Removed from `app.config.ts`. `expo-location` is not even a dependency; the entries only added privacy-label lines for capabilities the app never uses.                                                                                                              |

---

## 7. What is declared but not yet enforced

Worth knowing before you rely on it.

- **`APP_VERSION_UNSUPPORTED` (426)** exists in the error contract and every
  request sends `X-App-Version`, but no middleware checks it. Forcing an upgrade
  is one handler away; today an old build is not stopped.
- **Push is registered, not delivered.** The app posts its token to
  `/api/v1/devices` after sign-in, and `PUSH_PROVIDER=console` on Render means
  the worker logs instead of sending. Order events reach the phone only when the
  screen is open and polling.
- **Coupons** exist server-side; nothing in the app applies one.

---

## 8. How this was verified

Not asserted — run.

| Check                                          | Result                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| Every client call matched to a route by script | 24 calls, 0 missing, 0 auth mismatches                                                  |
| API reachable                                  | `/health/live` 200 in 12.5s (cold start)                                                |
| API healthy                                    | `/health/ready` → database `true`, redis `true`                                         |
| Storefront returns Admin's data                | 22 categories with Arabic names and emoji; 0 banners; rotation 5s                       |
| Geography reflects Admin's switches            | بغداد opened for ordering; the list changed from 1 governorate to 2 on the next request |
| Restaurant list                                | 6 restaurants, correct open/closed state for the hour, fees and minimums as seeded      |
| Menu and options                               | full menu for each; `الحجم` required, `إضافات` max 3, prices applied                    |
| Cart arithmetic against the live prices        | 18,000 + 500 modifier = 18,500; + 2,000 delivery = 20,500                               |
| Minimum-order rule                             | 4,000 against a 5,000 minimum → «أضف 1,000 د.ع»                                         |
| Seed idempotency                               | second run: `0 inserted, 6 updated`                                                     |
| Every screen rendered and photographed         | welcome, home, restaurant, item sheet, cart, account, favourites, closed restaurant     |
| App bundles                                    | iOS 1220 modules, Android 1171                                                          |
| Resolved app config                            | `apiUrl`, brand `#FF5400`, no camera/location strings                                   |
| Monorepo                                       | typecheck, lint, 386 tests, build — all clean                                           |

### What the visual pass found

Rendering the screens rather than reasoning about them turned up six defects
that typecheck, lint and tests all pass over:

1. **English in the middle of an Arabic card.** `cuisine_tags` stores keys —
   `shawarma`, `levantine` — and the cards joined the raw array. The contract
   calls those keys "never shown"; `cuisineLabelAr()` existed for exactly this
   and was not being used.
2. **A blank grey block** where a restaurant has no cover photo, which is every
   restaurant on the day it is approved. It read as a failed image; it is now a
   brand-tinted ground with the mark.
3. **Text glyphs standing in for icons** — `⌕`, `≡`, `★`, `−`, `+`, `‹`, `✆`,
   `•`. Several are not in Cairo and rendered as replacement boxes.
4. **Category names truncated mid-word** at one line; «أسماك ومأكولات بحرية»
   does not fit. Two lines now.
5. **Card badges on the wrong edge** under RTL — `insetInlineEnd` where the comp
   puts them on the start side.
6. **A sign-in button disabled** because the basket was below the restaurant's
   minimum. The minimum blocks checkout, not signing in, and nothing on screen
   explained the grey.

A seventh was a missing explanation rather than a defect: a closed restaurant's
dishes are faded and inert, but the «مغلق الآن» badge is off screen by the time
anyone scrolls into the menu, so tapping a dish did nothing with no reason
given. There is a line above the menu now.

What has **not** been verified: nothing has run on a physical device or
simulator. The browser pass used React Native Web with `dir="rtl"` forced,
which is a fair approximation and not the same renderer — Android's per-weight
font families, the bottom sheet with a keyboard open, the real safe-area insets
and push delivery are all unproven until `expo run:ios` and `expo run:android`
are executed.

Signing in is also unproven end to end, because staging has no SMS gateway:
everything behind the phone screen — checkout, placing an order, the order
timeline, rating, favourites — has been checked at the API and in the screens,
but never with a real session on a device.
