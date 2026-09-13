# Jibli mobile — design system and build plan

**Written for:** the engineers building the customer app, and whoever reviews it against the designs.

Ten HTML comps describe a complete customer journey. They now live in [`comps/`](comps/), renumbered in the order a customer moves through the app; that folder's README maps each file to its original name. This document turns them into one system: what each file is, what they disagree about, what we picked and why, where the dashboards drive the pixels, and what Apple will reject if we skip it.

---

## 1. The inventory

| Comp | Screen | Route | Status |
|---|---|---|---|
| `01-welcome.html` | شاشة البداية — brand, food doodles | `(auth)/welcome` | **built** |
| `02-phone.html` | تسجيل الدخول — phone entry | `(auth)/phone` | restyled |
| `03-otp.html` | التحقق — OTP with keypad | `(auth)/otp` | existing |
| `04-profile.html` | إكمال البيانات — name, governorate, city | `(auth)/profile` | existing |
| `05-home.html` | الرئيسية — search, promo, categories, restaurants | `(tabs)/index` | **rebuilt** |
| `06-restaurant.html` | تفاصيل المطعم — cover, menu, modifiers | `restaurant/[id]` | **built** |
| `07-cart.html` | السلة | `cart` | **built** |
| `08-order-detail.html` | تفاصيل الطلب — status timeline | `order/[id]` | **built** |
| `09-order-tracking.html` | تتبع الطلب — live, with driver card | `order/[id]` (same screen) | **built** |
| `10-account.html` | الملف الشخصي | `(tabs)/account` | **rebuilt** |
| — | المفضلة (the fourth tab both comps draw) | `(tabs)/favorites` | **built** |
| — | تأكيد الطلب (implied by the cart's CTA) | `checkout` | **built** |

There is no fourth file in the original numbering. Nothing references it; the journey is complete without it.

**Two places the comps needed a decision rather than a transcription.**

`01-welcome.html` is a splash: a wordmark, a slogan, food doodles, no controls. Shipped as a splash it would be a screen that does nothing, and the app would still route a signed-out customer straight to «أدخل رقم هاتفك» — the App Store problem in §6.2. So it became the welcome screen: the comp's art and type exactly, with the two entry choices added at the bottom where the tagline sat. The static splash it was drawn as is the native launch image, generated from the same tokens.

`08-` and `09-` are **one screen, not two.** Both are the order detail: the first shows the full status timeline, the second shows the same order while a driver is carrying it. Building them as two routes would mean two screens reading the same order and disagreeing about it the moment a status changed. One route, and the driver card appears when there is a driver.

**Tabs:** four — الرئيسية، المفضلة، طلباتي، حسابي. المفضلة was the addition; `customer_favorites` had existed since the first migration with nothing writing to it.

---

## 2. What the comps disagree about

Each file was designed on its own, so each picked its own brand colour. Left alone, this ships an app whose splash, home and profile are three different oranges.

| Comp | Orange |
|---|---|
| home, cart, profile | `#FF5400` |
| phone, order detail | `#FF5722` |
| order tracking | `#FF5500` |
| welcome | `#FF5E00` |
| restaurant | `#FF4700` |
| account | `#FF4713` |

**Decision: `#FF5400`.** It is the value on the home screen — the screen every session starts at and the one the brand is judged on — it is shared by three comps including the cart, and it sits at the median of the cluster, so no comp is more than a few degrees of hue from it.

This replaced `#FF6B2C` everywhere, **including the two web portals and the generated app icons**. That is the point of `@jibli/design-tokens`: the phone and the dashboards cannot drift, and keeping the old orange on the web to avoid a diff would have broken that on day one.

**Type.** The comps name four stacks: `Readex Pro + Cairo`, `Cairo`, `Tajawal`, and the system font. **Cairo**, which is already bundled in five weights and appears in every stack that names an Arabic face at all.

**Everything else was consistent enough to take as-is:** 16px tile radius, 24px card radius, the two-layer card shadow, `#111827` ink, `#6B7280` muted, `#F8F9FA` page.

---

## 3. Tokens that changed

Applied at the source (`packages/design-tokens`), which regenerates the web stylesheet, feeds the mobile theme, and redraws the app icons in one commit. A test asserts the committed stylesheet still matches its source, so a token edited without regenerating fails the suite rather than shipping.

```
brand            #FF6B2C → #FF5400      the home screen's orange
brandStrong      #F04E0A → #E24500      pressed, from the home comp
brandSoft        #FFF4ED → #FFF2EC      the tinted tile background
ink900           #16181D → #111827      the comps' near-black
radius.lg              14 → 16          the 2xl tile in every comp
radius.xl              20 → 24          the restaurant card
radius['2xl']          28 → 26          the promo banner
radius['3xl']               new         32 — the bottom sheet
shadow.md                 tuned         0 8px 24px -4px rgba(17,24,39,.06)
```

---

## 4. The kit

Fourteen primitives existed. The comps needed twelve more, all in `src/ui/catalog.tsx`, all token-driven, all RTL-safe, none below the 48px tap target:

`IconTile` · `SearchBar` · `PromoBanner` · `RestaurantCard` · `RatingPill` · `Stepper` · `StatusTimeline` · `DriverCard` · `SummaryRow` · `ListRow` · `Sheet` · `SegmentedProgress`

Three judgement calls inside them:

- **`Stepper`** gives each control a full tap target even though the comp draws them at 28px. A 28px minus button beside a 28px plus button is how someone removes an item they meant to add one of.
- **`RestaurantCard`** puts a real gradient scrim under the overlay badges. They are white text on whatever photograph the restaurant uploaded, and a pale dish makes them unreadable.
- **`RatingPill`** shows «جديد» rather than a fake `0.0` when a restaurant has no ratings yet.

Two dependencies were added for this: `react-native-svg` (the wordmark is transcribed from the comp's vector — the mark's J-dot is a location pin, and a bold-font approximation loses the whole idea) and `@expo/vector-icons` (the tab bar, the header, every affordance the comps draw as an SVG icon).

---

## 5. Where the dashboards drive the pixels

This is the part that had to be wired, not just drawn.

| What the customer sees | Where it comes from | Endpoint |
|---|---|---|
| Promo banner, its art, its order, how long it holds | Admin → شكل التطبيق | `GET /storefront` |
| Category strip: names, images, order | Admin → التصنيفات | `GET /storefront` |
| Which restaurants appear at all | Admin → المطاعم + geography | `GET /restaurants` |
| Restaurant open/closed, accepting orders | Restaurant portal → working hours | `GET /restaurants/:id` |
| Menu, prices, availability, options | Restaurant portal → المنيو | `GET /restaurants/:id`, `GET /catalog/items/:id/modifiers` |
| Delivery fee, minimum order | Admin → restaurant detail | `GET /restaurants` |
| The authoritative total | server-side pricing | `POST /checkout/quote` |
| The 500 IQD commission | Admin → الإعدادات | invisible to the customer, applied server-side |
| Order status as it moves | Restaurant portal → order board | `GET /orders/:id` |
| Rating window opening 15 minutes after delivery | Admin → الإعدادات | `GET /orders/:id/review-eligibility` |

**Nothing on the home screen is a constant in the app.** A Ramadan banner, a promoted category, a reordered strip — all of it moves without a release, which matters because a release takes a week to reach every phone through two review queues.

**Three gaps in that wiring had to be closed on the server** before the screens could be honest:

1. **`GET /auth/me` never returned the customer's city.** The mobile `Me` type declared `city_id`, the server never sent it, and `GET /restaurants` requires one — so the home screen's restaurant query was disabled forever and every signed-in customer saw «أكمل ملفك أولاً». The area now rides along with its Arabic names.
2. **Favourites had a table and no endpoints.** `GET/PUT/DELETE /api/v1/favorites` now exist, returning the same card shape as discovery so both lists render through one component.
3. **There was no way to delete an account** (§6.1).

---

## 6. What Apple will reject

Ordered by how likely it is to actually happen.

### 6.1 Account deletion — guideline 5.1.1(v) · **was blocking, now closed**

An app that lets you create an account must let you delete it **from inside the app**, not by emailing support. This is the most common rejection for a delivery app.

`DELETE /api/v1/profile`, reached from a «حذف حسابي» row on the account screen behind a sheet that says what actually happens. Deletion is anonymisation, not a `DROP`: orders and settlements are financial records belonging to the restaurant and the platform as much as to the customer, and a delivered order cannot stop having happened. Name, phone, saved addresses, push tokens and favourites go; the user row is scrubbed, detached and deactivated; every session is revoked; an audit row records it.

Two refusals, both stated in the sheet before the customer commits: an order in flight (there is a driver on the way and cash to collect), and an account holding staff or restaurant roles (that access was granted by someone else and has to be removed by them).

### 6.2 Forcing registration to browse — 5.1.1(ii) · **was high risk, now closed**

Apple rejects apps that demand an account for content that does not require one. The app used to route a signed-out customer straight to `(auth)/phone` and show nothing else.

Now: the welcome screen offers «تصفح كضيف» beside signing in; the choice is remembered so it is asked once; browsing, searching, reading a full menu and filling a cart all work signed-out; and the phone number is asked for at the cart's CTA, where an account genuinely is required, with the label saying so. `GET /storefront`, `GET /restaurants` and the menu endpoints were already public — nothing had to be opened up.

A guest still sees all four tabs. المفضلة and طلباتي ask for an account when opened rather than hiding: telling a browsing customer the app does less than it does is its own kind of dishonesty.

### 6.3 Privacy — 5.1.1, 5.1.2

- **Privacy policy reachable in-app**: a row on the account screen and a tappable link on the sign-in screen, where consent is actually given. URLs come from `extra` in `app.config.ts`, so changing them is not a release.
- **App Privacy answers** must declare what is collected: phone, name, delivery address, order history. No tracking across apps, so no ATT prompt — but it must be declared as "not tracking" rather than left blank.
- **`NSCameraUsageDescription` has been removed.** It claimed delivery-proof photography, which the *customer* app never does — that is Driver Mode's job and it does not ship in this binary. A purpose string for an unused capability is itself a rejection, and it would have put a data type in the privacy label that Jibli does not collect.

### 6.4 Support and contact — 1.5

A support URL on the listing, and a way to reach a human in-app: the «المساعدة والدعم» row dials the support number from config.

### 6.5 Sign in with Apple — 4.8 · *not applicable, and kept that way*

`02-phone.html` draws «أو تابع باستخدام» with Google and Apple buttons. **They were not built.** There is no social identity provider behind them, and adding one would pull 4.8 into scope: a third-party login obliges the app to offer Sign in with Apple beside it. Phone OTP is the only way in, which keeps 4.8 out of scope entirely. If social login is ever wanted, 4.8 comes with it.

### 6.6 Payments — 3.1.1 · *not applicable, worth stating*

In-app purchase is required for digital goods. Food is physical, so cash on delivery is fine and IAP must **not** be used. Written down because it is a common misreading that causes people to build the wrong thing.

### 6.7 The smaller ones

- **4.2 minimum functionality** — real app, not a wrapped website. Fine.
- **2.1 completeness** — no placeholder art, no dead buttons, no Lorem. Every control in this commit goes somewhere: the category tabs scroll to their section, the order cards open the order, the cart's CTA reaches checkout. **The app icon is still generated placeholder art and must be replaced before submission.**
- **iPad** — `supportsTablet: false` still has to run in iPhone compatibility mode without crashing.
- **Demo account** — App Review needs a working phone number and OTP, or they cannot get past the first screen. Provide one in App Review notes. With guest browsing they can at least see the app without it, which helps.

---

## 7. Build order

1. ~~**Tokens and kit**~~ — palette reconciled across mobile and both portals, twelve components added.
2. ~~**Guest browsing + welcome**~~ (`01-welcome.html`) — the §6.2 blocker; changed the routing gate, so it came before the screens inside it.
3. ~~**Home**~~ (`05-home.html`) — location header with area picker, search, banner carousel, category strip, restaurant cards.
4. ~~**Restaurant + menu**~~ (`06-restaurant.html`) and ~~**cart**~~ (`07-cart.html`).
5. ~~**Checkout → order detail**~~ (`08-`, `09-`) — one screen, driver card on assignment, rating at the 15-minute mark.
6. ~~**Account**~~ (`10-account.html`) — including §6.1 deletion and §6.3 privacy links.
7. ~~**Favourites tab**~~.
8. **Submission pass** — the remainder:
   - Real app icon and splash artwork (the generated ones are placeholders that look deliberate, which is not the same as final).
   - Privacy policy and terms pages actually published at the configured URLs.
   - App Privacy answers filled in; ATT declared as "not tracking".
   - A demo account for App Review.
   - `04-profile.html` still asks for a profile photo, an email and a first delivery address that this build does not collect; decide whether they ship before submission or after.

---

## 8. What is still worth knowing

- **The cart's rules are tested, the screens are not.** `reduceCart` is a pure reducer with nine tests covering the three rules that decide whether an order can be placed at all — one restaurant at a time, an empty cart is no cart, quantity zero removes. The screens have no tests; the next most valuable one is the checkout's idempotency key surviving a retry.
- **It bundles, and that took three fixes a typecheck could never have found.** `@babel/runtime` was not a dependency; `tsconfig`'s `react` path mapping — which exists so TypeScript resolves React 18 — was being applied by Metro to *runtime* resolution, so `import 'react'` resolved to a types package with no JavaScript; and the workspace packages' `./x.js` specifiers needed the same treatment Webpack gets in `config/next-portal.mjs`. `pnpm deploy:check` now bundles the app so this cannot regress. Details in [`../mobile/running-the-app.md`](../mobile/running-the-app.md) §5.
- **Nothing here has run on a device.** Typecheck, lint, 386 tests and a Metro bundle for both platforms are all clean, but `expo run:ios` has never been executed against this code. The first device run is where RTL layout, font weights on Android, and the sheet's keyboard behaviour will actually be judged.
- **The wiring is verified; the data is not populated.** All 24 endpoints the app calls resolve, the deployed API is healthy, and the 22 categories on the home screen come from Admin. But the only ordering-enabled area has no restaurants, so the list is empty until someone enables بغداد for ordering. [`../mobile/integration.md`](../mobile/integration.md) has the full map of which dashboard switch drives which pixel.
- **The OTP and profile screens are the two the comps still lead.** They work and they use the tokens, but they predate the kit — `04-profile.html` in particular describes a richer profile step than what is built.
