# The two portals

Admin runs the platform. Restaurant runs one restaurant. They share a shell, an
auth flow and an edge guard, and share nothing else — a restaurant user cannot
reach an admin route, and cannot reach another restaurant's data.

This document is the reference for both, and for what the mobile apps will
depend on them for. It was written against the code, not the plan; where the two
disagree, the code is what ships.

---

## 1. Who signs in, and how

Both portals use **username and password**. Neither uses the phone-and-OTP flow
the mobile apps use, and that separation is deliberate: the portals must keep
working when no SMS gateway exists, which is exactly the situation today.

| | Admin | Restaurant |
|---|---|---|
| Account created by | `bootstrap-admin` script, then Admin → Users | Admin → Restaurant → portal credentials |
| Minimum password | 14 characters | 12 characters |
| First sign-in | forced password change | forced password change |
| MFA | required before sensitive routes | required before sensitive routes |
| Lockout | 6 failures → 15 minutes | 6 failures → 15 minutes |

Password policy follows NIST SP 800-63B: length over composition, and **no
forced periodic expiry** — rotation on a schedule makes people pick weaker
passwords, not stronger ones.

A generated password is shown **once**. There is no way to read it back; reset
issues a new one. The alphabet excludes `O/0`, `l/1/I` and vowels, because these
are delivered by reading them down a phone.

### The session

An access token lives in memory only, never in `localStorage`. The refresh token
is an `HttpOnly` cookie. The browser talks only to its own origin — `/api/*` is
rewritten to the API by Next — so the cookie is first-party and CORS never
enters the picture.

`packages/ui-web/src/middleware.ts` guards routes at the edge before any page
renders. It separates paths reachable while signed out from paths reachable
*only* while signed out, and validates the return parameter against open
redirects: protocol-relative URLs, backslash-prefixed hosts, `javascript:` and
control characters are all rejected.

---

## 2. Roles and permissions

**57 distinct permissions**, granted through roles. Never checked ad hoc — every
route asserts one.

**8 platform roles**: `SUPER_ADMIN`, `OPERATIONS_ADMIN`, `FINANCE_ADMIN`,
`RESTAURANT_ONBOARDING`, `SUPPORT_AGENT`, `MARKETING`, `ANALYST`, `AUDITOR`.

**6 restaurant roles**: `OWNER`, `MANAGER`, `CASHIER`, `KITCHEN`,
`INVENTORY_MANAGER`, `ACCOUNTANT`.

`KITCHEN` is the narrowest and worth reading as the model for the rest:
`order.read`, `order.prepare`, `order.ready`, `menu.read`, `inventory.read`. A
kitchen screen cannot see money.

---

## 3. Admin portal

| Route | What it does |
|---|---|
| `/` | Headline tiles, order status split, 30-day sales and 7-day commission series |
| `/orders` · `/orders/live` · `/orders/cancelled` | All orders; the live board; cancellations with reasons |
| `/restaurants` · `/new` · `/[id]` | Directory, onboarding, and the full file for one restaurant |
| `/applications` | Onboarding applications — approve or reject |
| `/categories` | Cuisine categories |
| `/users` · `/drivers` | Platform-wide people; driver suspension |
| `/finance/settlements` · `/[id]` | Settlement periods and one settlement's detail |
| `/finance/invoices` · `/finance/reports` | Invoices; revenue and commission reporting |
| `/coupons` | Create and schedule coupons — see §7, they do not reach checkout yet |
| `/geography` | Governorates and cities, and the three capability switches |
| `/settings` | All 11 platform config keys |
| `/settings/roles` · `/settings/mfa` | Who holds what; MFA enrolment |
| `/audit` | Every privileged action, who did it and when |

### Geography is the master switch

Each city carries three independent flags: **customer signup**, **restaurant
onboarding**, **ordering**. Turning one on takes a reason, which is recorded.

Nothing is enabled today. That is why the public geography endpoints return an
empty list — the gated rollout working, not a fault. The order to enable them is
onboarding first, ordering last (ADR-0003): sign restaurants before you let
anyone order from a city that has none.

---

## 4. Restaurant portal

| Route | What it does |
|---|---|
| `/` | Today's orders, revenue, commission owed, low stock |
| `/orders` | The live board — accept, reject, assign a driver |
| `/menu` | Categories, items, availability, modifier groups |
| `/inventory` | Stock, movements, recipes, low-stock thresholds |
| `/drivers` | Add a driver, activate or deactivate, cash custody |
| `/staff` | Portal users for this restaurant and their roles |
| `/commissions` · `/profits` | What is owed; profit after commission and expenses |
| `/settlements` · `/[id]` | Settlement periods, and disputing one |
| `/settings` | Working hours, exceptions, busy mode |
| `/alert-test` | Order-alert QA harness — see below |

`/alert-test` is not a leftover. Browser autoplay policy cannot be verified by a
unit test, so this page drives the real `OrderAlertManager` on the restaurant's
own tablet during onboarding. It is what satisfies the `orderAlertAcknowledged`
readiness check. A restaurant that never hears the alert misses orders.

### Tenant isolation

Verified by reading every route, not by assumption:

- **48 restaurant-portal routes. Every one calls `restaurantScope(request)` and
  `assertRestaurantPermission(...)`** — with exactly one exception,
  `/restaurant-portal/me`, which returns the restaurants the session belongs to
  and derives that list from session membership, never from a parameter. A user
  cannot name a restaurant they do not belong to.
- **49 admin routes. Every one calls `assertAdminPermission(...)`.**

---

## 5. The driver, provisioned by the restaurant

This is the flow most likely to be misunderstood, so it is written out in full.

1. The restaurant opens `/drivers` and adds a driver: name, Iraqi phone, vehicle
   type, and whether they may collect cash.
2. `POST /api/v1/restaurant-portal/drivers` (permission: `driver.manage`) then,
   in one transaction:
   - **reuses the identity** if that phone already exists — the driver may
     already be a customer, and a person is one identity
   - creates it if not, and fills in the name only when the existing identity
     has none, because overwriting a customer's own name would be wrong
   - creates the driver profile as `PENDING_ACTIVATION`
   - creates the restaurant membership, carrying `canCollectCash`
   - writes an audit row and enqueues a `DRIVER_INVITED` outbox event
3. The driver installs the Jibli app and **signs in with their own phone and an
   OTP**. That is what activates the account. The restaurant never sees or sets
   a driver password.

Two consequences worth stating plainly:

- A driver can work for more than one restaurant. The profile is per identity;
  the membership is per restaurant. Adding a driver already in this restaurant
  returns `CONFLICT` rather than creating a duplicate.
- **Driver activation is blocked until a real SMS gateway exists.** The
  restaurant can provision drivers today; none of them can sign in. It is the
  same blocker as customer signup, and the only one of its kind.

Cash is tracked from both sides: the restaurant sees custody and records a
handover; the driver sees what they are holding.

---

## 6. What the mobile apps depend on

The portals are where an operator changes what the phone sees. These levers
exist today.

| Lever | Where | Why it matters on a phone |
|---|---|---|
| `minimum_app_version` | Admin → Settings | Below it, the app is told to force an update. This is how a breaking API change survives customers who never update |
| `latest_app_version` | Admin → Settings | Offers a non-blocking update prompt |
| `global_checkout_enabled` | Admin → Settings | Platform-wide kill switch, with its own danger banner |
| `support_phone` | Admin → Settings | The number the app shows when something goes wrong |
| `order_acceptance_timeout_minutes` | Admin → Settings | How long a restaurant has before an order escalates |
| `delivery_pin_enabled` | Admin → Settings | Whether the customer reads a PIN to the driver at handover |
| `max_active_deliveries_per_driver` | Admin → Settings | Assignment capacity |
| Customer signup, per city | Admin → Geography | Whether a phone in that city can register at all |
| Ordering, per city | Admin → Geography | Whether checkout is offered there |

The app sends `X-App-Version`; `GET /api/v1/app/config` answers with
`minimum_version`, `latest_version`, `update_required`, `update_available`. A
request with no version header is treated as supported — refusing to serve a
client that forgot a header would lock people out over a header bug.

Push registration is `POST /api/v1/devices`, for any signed-in user. It used to
be `/api/v1/driver/devices`, which would have made the customer app call a
driver-named route.

### The customer API, complete today

Discovery (`GET /restaurants`, `/restaurants/:id`,
`/catalog/items/:id/modifiers`), pricing (`POST /checkout/quote`), ordering
(`POST /orders`, `GET /orders`, `GET /orders/:id`,
`POST /orders/:id/cancel`), addresses and profile. The screens are what is
missing, not the endpoints.

In `APP_ENV=local` the OTP is returned in the response body, so the app can be
built and signed into with no SMS provider at all.

---

## 7. Gaps, stated so nobody finds them the hard way

| Gap | Consequence |
|---|---|
| No SMS gateway | No customer and no driver can sign in. The portals are unaffected |
| Coupons never reach checkout | `coupon_redemptions` exists with a unique index on the order, `calculateOrderTotals` accepts a discount, and Admin creates coupons — but no code path applies one at quote or order time. Coupons can be created and never used |
| No upload endpoint | The `assets` table and its keys exist. No restaurant logo, no dish photo, anywhere |
| No push provider | Tokens register; nothing sends |
| `INVALID_CREDENTIALS` names the phone | Shared with the phone-OTP flow, so a failed *username* sign-in names the wrong field |
| Restaurant portal never run with a real account | It builds, deploys and reaches the API. No restaurant exists yet, so no page has been exercised against real data |
| No automated test touches a database | 309 tests pass and none runs a query. `raw-sql.test.ts` refuses two shapes known to fail at runtime; it cannot prove a query works |
