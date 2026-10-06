# Plan — Owner Mode in the mobile app

A shop owner signs into the Jibli app with the username and password their
portal account already uses, and manages their shop from the phone: see the
products, add one in under a minute with a photograph taken on the spot, change
the shop's picture.

Shipped for **Jibli Market first**, and built so that adding Cosmetics later is
adding an enum value rather than writing the feature again.

---

## What already exists

This is the part worth establishing before any code is written, because most of
it is done and rebuilding it would be the expensive mistake.

| Piece                                 | Where                                                       | State                                                                                     |
| ------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Owner sign-in by password             | `POST /api/v1/auth/login`, `client: 'mobile'`               | **Works.** Returns `portal: 'RESTAURANT'` and a token pair                                |
| The app's client for it               | `api.passwordSignIn` in `src/lib/api.ts`                    | **Works.** Used today by courier sign-in                                                  |
| Which shops this user owns            | `GET /api/v1/restaurant-portal/me`                          | **Works.** Returns `merchant_type` and roles per shop                                     |
| Product read / create / edit / delete | `/api/v1/restaurant-portal/menu/*`                          | **Works.** Gated on `menu.write`                                                          |
| Shop profile, including its picture   | `PUT /api/v1/restaurant-portal/settings` (`logo_asset_id`)  | **Works**                                                                                 |
| Image upload                          | `POST /api/v1/uploads` — base64, ≤5 MB, returns an asset id | **Works**                                                                                 |
| Permission model                      | `RESTAURANT_ROLE_PERMISSIONS` in `@jibli/contracts`         | **Works.** `OWNER` holds everything; `MANAGER` holds `menu.write` and `settings.write`    |
| Tenant scoping                        | `X-Restaurant-Id` header, resolved by `restaurantScope`     | **Works.** The header only _selects_ among shops the session already proves membership of |

`GET /restaurant-portal/me` already carries a comment saying it returns
`merchant_type` "so the portal can say «المنتجات» to a grocer and «القائمة» to a
cook." The vertical split this feature needs was anticipated; it has simply
never had a client.

**No database change is required.** A market's product is a `menu_items` row
under a `menu_categories` row, exactly as a dish is. `restaurants.merchant_type`
is what separates a grocer from a kitchen, and it is already indexed.

## What is missing

1. **The app refuses owner accounts on purpose.** `(auth)/driver-login.tsx`
   answers a `RESTAURANT` portal login with «هذا الحساب ليس حساب مندوب. استخدم
   لوحة التحكم على المتصفّح.» That sentence is the feature request.
2. **The session model has no idea what an owner is.** `Me.modes` in
   `src/lib/session.tsx` is `('CUSTOMER' | 'DRIVER')[]`.
3. **There is no owner surface** — no route group, no screens.
4. **The phone cannot pick or shrink a photograph.** Neither
   `expo-image-picker` nor `expo-image-manipulator` is installed.

---

## Decisions

### One API, not an owner API

Owner Mode calls `/api/v1/restaurant-portal/*` — the same endpoints the web
portal calls. There is no `/owner/*` namespace.

A parallel namespace would be a second implementation of every permission check
and every tenant guard, and the two would drift the first time one of them
gained a rule. The phone is a second client of one portal, not a second portal.

### The vertical is data, not a screen

What Owner Mode shows is chosen from `merchant_type`, read from
`/restaurant-portal/me`:

```
MARKET     → «المنتجات», a grid of products, quick-add
RESTAURANT → not offered on the phone in this release; the web portal is richer
             and a kitchen's menu has modifier groups a phone form cannot serve
COSMETICS  → the same screens as MARKET, the day the enum gains the value
```

The gate is one predicate — `merchantType === 'MARKET'` — expressed once. Adding
Cosmetics is widening that predicate and adding a label; it is deliberately not
a new screen, a new route or a new client.

That is what "supports the same thing in future" has to mean to be true later:
if the Cosmetics case needs new screens, this design failed.

### Restaurants are excluded on purpose, and it is not an oversight

A dish carries modifier groups — size, bread, extras — with required/optional
rules and per-option prices. Editing that on a phone is a worse tool than the
web portal, not a faster one. A grocery product is a name, a price, a photo and
a category, which is exactly the shape a phone is good at.

Restaurants get read-only visibility in a later release if it is asked for.

### Photographs are shrunk on the phone, at the same tiers as the web

`packages/ui-web/src/logo-upload.tsx` decides how much of an image is worth
keeping, by what it is drawn at: `icon` 512, `photo` 1280, `banner` 1920. A
12-megapixel phone photo posted raw is ~5 MB of base64 against a 5 MB ceiling —
it would fail, and slowly.

So the phone applies the same table through `expo-image-manipulator` before
`POST /uploads`. **The tiers live in one place and both clients read them**, or
they drift, and the drift is invisible until a grocer's product photo looks
worse than the same photo uploaded from a laptop.

### The header is a selector, never a grant

An owner with two shops picks one, and the pick becomes `X-Restaurant-Id`.
`resolveRestaurantScope` already throws `TENANT_MISMATCH` when a claim is not
backed by membership, so a tampered header buys nothing. The client stores the
choice; the server never trusts it.

---

## Shape

```
src/app/(auth)/partner.tsx         «صاحب متجر؟» — register a shop, or sign into one: the two doors
src/app/(auth)/owner-login.tsx     username + password, rejects non-RESTAURANT portals
src/app/(owner)/_layout.tsx        holds the selected shop, refuses a non-market shop
src/app/(owner)/_layout.tsx        draws Owner Mode in the shop's own section colour
src/app/(owner)/index.tsx          the lobby: picture, taking orders or not, today, the doors
src/app/(owner)/categories.tsx     the aisles: suggested per kind, custom, rename, hide, delete
src/app/(owner)/settings.tsx       picture, name, blurb, phone, fees; «عرض المتجر كزبون»
src/app/(owner)/products.tsx       the product list — search, category filter, availability toggle
src/app/(owner)/product/[id].tsx   add or edit: name, price, category, photo, available
src/lib/owner.tsx                  the owner session: shops, the selected one, roles
src/lib/upload.ts                  pick → shrink to the tier → POST /uploads
```

Mirrors `(driver)`, which is the established pattern for a second audience
inside the customer binary: a separate route group, reached deliberately from
«حسابي», with its own sign-in.

### The one screen that has to be excellent

**Add a product.** It is the screen a grocer uses two hundred times and every
other screen once. The target is _under a minute, standing in the aisle_:

- Camera opens first, not a form. The photograph is the slow part and the part
  that needs the shop's light.
- Name, price, category. Nothing else is required.
- The category defaults to the last one used — a grocer stocking a shelf adds
  eight things from one category in a row.
- Save returns to the camera, not to the list, so the next product is one tap.
- The price field is numeric-only and Latin-digit, with the same
  Arabic-Indic normalisation the OTP screen uses.

Everything else on the screen is optional and collapsed.

---

## Phases

Each phase is shippable and independently useful.

**1 — Sign in and look. Shipped.** Owner login, shop picker, product list,
product form. Tested end to end against the live API with a real merchant
credential: the same username and password the shop uses on the portal.

**2 — The photograph.** Capture and the upload pipeline, which need
`expo-image-picker` and `expo-image-manipulator` — native modules, so a new
build rather than an over-the-air update. The slot is drawn and says so.

**3 — The shop itself.** Change the picture, toggle accepting orders.
`settings.write`.

**4 — Cosmetics.** Widen the predicate. Expected diff: an enum value and a
label. If it is more than that, phases 1–3 got the abstraction wrong.

## What could not be tested, and why

The market screens have not been exercised end to end, because **the pilot
database has no market merchant** — checked across all three
ordering-enabled cities, zero. The obvious way to fix that is to create one,
and it is the wrong way: a fake shop in the pilot database appears to real
customers browsing the market half.

So the vertical gate — the one rule everything else hangs off — is pinned by
`src/lib/owner-vertical.test.ts` instead, which is why that rule lives in a
module with no React in it. What _was_ tested against the live API, with a
real merchant credential:

- sign-in with the shop's own portal username and password
- the session surviving the customer profile gate an owner cannot satisfy
- routing into `(owner)` without being bounced to the customer chooser
- the vertical gate refusing a restaurant, with the honest reason on screen
- «متجري» appearing in «حسابي» only once the account holds a shop role

Give Owner Mode a real market merchant and the rest is a five-minute pass.

## Risks worth naming now

- **`expo-image-picker` is a native module**, so phase 2 needs a new build and
  cannot ship as an over-the-air update. Plan it into a version bump.
- **Camera and photo-library permission strings** are new entries in
  `app.config.ts`, and both stores reject a purpose string that does not name
  the actual use. They must say "to photograph a product you are adding".
- **An owner is also a customer.** The same person may order lunch from the app
  they manage their shop in. Owner Mode is a destination, not a mode switch that
  changes the whole app — the tab bar stays the customer's.
- **Two shops, one phone.** The selector must be visible, not buried, or a
  grocer will add a product to the wrong branch and blame the app.
