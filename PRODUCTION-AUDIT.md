# JIBLI — PRODUCTION AUDIT

**Date:** 19 September 2026
**Commit audited:** `274e856` (working tree clean)
**Scope:** whole monorepo — mobile app, API, worker, admin portal, restaurant portal, driver system, database, build configuration
**Method:** static audit + toolchain runs. No code modified.

> **Note on prior session.** Commit `274e856` contains ~42 modified files in `apps/mobile` from a previous fix session (RTL, request timeouts, push payload, icon-font subsetting, tab-bar insets). This audit reflects that state. Findings that were *created* or *closed* by that work are marked.

---

## 1. Executive Summary

The platform is **substantially more complete than a typical pre-launch codebase**. The domain model is real: 71 tables, 141 foreign keys, a declarative order state machine with actor authorization, server-side price recalculation, row-level locking with optimistic concurrency, an outbox pattern, and end-to-end tests that assert financial integrity (no double commission, no double COD collection, no inventory oversell). Authorization is re-resolved from the database on every request rather than trusted from the token. No secrets are committed anywhere in history.

**It is not ready to launch.** Six P0 items block it. The most serious is not a store rule — it is that **push notifications do not work at all, anywhere, and report success while failing.**

### What actually blocks launch

| ID | Problem | Impact |
|----|---------|--------|
| **P0-1** | Push notifications are a no-op in production and are recorded as `SENT` | Whole feature dead; drivers not alerted to assignments |
| **P0-2** | Deployed API runs `APP_ENV=staging`; only one phone number can sign in | No real customer can register |
| **P0-3** | `jibli.iq` has no DNS — privacy/terms links dead, baked into binary | Rejection on both stores |
| **P0-4** | API on a plan that sleeps; ~60s cold start | App Review sees an empty app → 2.1 |
| **P0-5** | No FCM credentials for Android | Android push cannot work even after P0-1 |
| **P0-6** | No tile provider; falls back to a server whose policy forbids distributed apps | Licence violation shipped |

### Verdicts

| Area | Verdict |
|------|---------|
| Production Readiness | **NOT READY** |
| Apple App Store | **NOT READY** |
| Google Play | **NOT READY** |
| Security | **PASS WITH ISSUES** |
| Backend | **PASS WITH ISSUES** |
| Customer App | **PASS WITH ISSUES** |
| Restaurant System | **PASS** |
| Driver System | **PASS WITH ISSUES** |
| Admin Dashboard | **PASS** |
| Location / GPS | **PASS** |
| Database | **PASS** |

---

## 2. Project Architecture

pnpm monorepo, TypeScript throughout, Node ≥ 20.19.4.

| Layer | Technology |
|-------|-----------|
| Mobile | Expo SDK 57, React Native 0.86.3, React 19.2.3, expo-router |
| Portals | Next.js (admin, restaurant, legal) |
| API | Fastify, Drizzle ORM, Zod, Argon2 (`@node-rs/argon2`) |
| Worker | Node, outbox publisher + scheduled jobs |
| Database | PostgreSQL — 71 tables, 141 FKs, 94 indexes, 17 migrations |
| Realtime | WebSocket via Redis pub/sub |
| Cache / limits | Redis (`ioredis`) |
| Deploy | Render (API, worker), Vercel (portals), EAS (mobile) |

13 shared packages: `auth`, `contracts`, `db`, `domain`, `money`, `geography`, `validation`, `notifications`, `config`, `logger`, `design-tokens`, `ui-web`, `test-utils`.

---

## 3. Current Applications & Dashboards

| Component | Technology | Status | Backend Connected | Production Ready |
|-----------|-----------|--------|-------------------|------------------|
| Customer App | Expo / RN | Functional | ✅ Yes | ⚠️ With fixes |
| Driver Mode (in mobile) | Expo / RN | Functional | ✅ Yes | ⚠️ With fixes |
| Driver Portal (web) | Next.js | Functional | ✅ Yes | ✅ Yes |
| Owner Mode (in mobile) | Expo / RN | Partial | ✅ Yes | ⚠️ Photo upload not wired |
| Admin Dashboard | Next.js — 28 pages | Functional | ✅ Yes | ✅ Yes |
| Restaurant Dashboard | Next.js — 20 pages | Functional | ✅ Yes | ✅ Yes |
| Legal site | Next.js — 4 pages | Built | n/a | ❌ **Not deployed** |
| Backend API | Fastify — 197 endpoints | Functional | n/a | ⚠️ Staging config |
| Worker | Node | Functional | ✅ Yes | ❌ **Push is a stub** |
| Database | PostgreSQL | Complete | n/a | ✅ Yes |
| Notifications | — | **Broken** | ⚠️ Partial | ❌ **No** |
| Maps | Leaflet in WebView | Functional | n/a | ❌ **No tile key** |

**Driver system exists in two places** — Driver Mode inside the mobile app (`apps/mobile/src/app/(driver)/`) and a web portal (`apps/restaurant-web/src/app/driver/`). Both hit the same API. This is a deliberate dual surface, not duplication.

---

## 4. Customer App

### Authentication

| Feature | Status | Evidence |
|---------|--------|----------|
| Phone OTP sign-in | ✅ Works | `apps/api/src/routes/auth.ts` |
| OTP rate limiting | ✅ Per-phone/hour, per-phone/day, per-IP/hour, max verify attempts | `apps/api/src/services/otp-service.ts:102,111,123,168` |
| Session persistence | ✅ Keychain / Keystore, `WHEN_UNLOCKED_THIS_DEVICE_ONLY` | `apps/mobile/src/lib/secure-session.ts:26` |
| Token refresh | ✅ Single-flight, prevents replay-revocation | `apps/mobile/src/lib/api.ts:141` |
| Server-side revocation | ✅ Session checked on every request | `apps/api/src/plugins/auth.ts:60` |
| Guest browsing | ✅ Real state, not a screen | `apps/mobile/src/lib/session.tsx` |
| Account deletion | ✅ In-app + API + anonymization | `apps/api/src/routes/profile.ts` |
| Google sign-in | ⚠️ Code exists, disabled (no client IDs) | `apps/mobile/app.config.ts` |
| Forgot password | n/a — customers have no password |

**Note:** enabling Google sign-in on iOS triggers App Store Guideline 4.8 (requires an equivalent privacy-respecting option, e.g. Sign in with Apple). Not implemented. Leave disabled.

### Home / Restaurant / Cart

All screens are backed by real endpoints. Search queries dishes across the city, debounced 300 ms (`apps/mobile/src/app/(tabs)/index.tsx:110`).

**Price integrity — verified.** The client's `expected_total_iqd` is used **only** for a "did it change?" comparison. Every price is recalculated from the catalog server-side:

> `apps/api/src/services/order-service.ts:222` — *"Recalculate every price from the catalog; the client's numbers are only ever used for the 'did it change?' comparison."*
> `assertQuoteUnchanged` → `PRICE_CHANGED` — `packages/domain/src/ordering/quote.ts:264`

A tampered client cannot set its own price.

---

## 5. Restaurant Dashboard

20 pages, all backend-connected. Orders, menu, inventory, staff, finance, settlements, support, reviews, commissions, driver management.

**Tenant isolation — verified.** Every one of 12 route modules calls `restaurantScope()`; endpoint count matches scope-call count exactly in 11 of 12. The twelfth (`me.ts`) derives its list from session membership instead, which is stronger.

`resolveRestaurantScope` (`packages/auth/src/principal.ts:133`) treats the `X-Restaurant-Id` header as a **selector, never a grant** — it throws `TENANT_MISMATCH` if the session does not already prove membership.

**Restaurant A cannot read, edit, or act on Restaurant B.** No IDOR found.

**Order alerts** use WebSocket + audio (`apps/restaurant-web/src/components/live-board.tsx`). This is the one role whose notifications *do* work, because it does not depend on push.

---

## 6. Driver System

### Registration

`POST /api/v1/driver/apply` (`apps/api/src/routes/driver.ts`). Collects: vehicle type, plate number, photo asset id. Requires a completed profile first.

**Statuses:** `PENDING_ACTIVATION` → `ACTIVE` → `SUSPENDED` (`packages/contracts/src/enums.ts:200`, `packages/db/src/schema/delivery.ts:38`).

**Not collected:** ID documents, licence, bank account. If your operation requires them, they do not exist. — **Design decision, not a defect, but confirm it is intended.**

### Assignment model

**Drivers belong to a restaurant, not a shared pool.** Assignment is **manual by restaurant staff** (`POST /api/v1/restaurant-portal/orders/:orderId/assign-driver`), gated by the `driver.assign` permission. There is no automatic dispatch.

Race protection is at the database level: a partial unique index on active assignments per driver turns a double-assign into a `23505` collision → `DRIVER_AT_CAPACITY` (`apps/api/src/routes/restaurant/orders.ts:380`).

### Security — verified

`assertDriver` and `assertOwnsAssignment` are applied consistently, and queries are scoped by `driverId`:

- `apps/api/src/routes/driver.ts:365` — ownership asserted **before** any task data is returned
- `apps/api/src/routes/driver.ts:429` — asserted before any state change
- `apps/api/src/services/delivery-service.ts:89` — asserted inside the delivery transaction

**Driver A cannot see or act on Driver B's assignment.**

### The gap

A driver learns about a new assignment through **push (broken — P0-1)** or **a 30-second poll** (`apps/mobile/src/app/(driver)/delivery.tsx:593`). With push dead, a driver must keep the app open and wait up to 30 seconds. For a delivery operation that is a real constraint, not a cosmetic one.

---

## 7. Admin Dashboard

28 pages. Users, restaurants, markets, drivers, orders (all/live/cancelled), geography, coupons, categories, appearance, reviews, support, audit log, finance (settlements, reports, invoices), roles, MFA.

All pages are backend-connected; several delegate to shared components (`order-list-screen`, `merchant-directory`) rather than calling the API inline — verified those components do call it.

`finance/invoices/page.tsx` is deliberately **not** a tax-invoice feature and says so in its own header comment. Not a gap; a scoped decision.

---

## 8. Backend & APIs

**197 endpoints.** Middleware: `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/cookie`, `@fastify/sensible` (`apps/api/src/server.ts:97-149`).

### Authorization — the strongest part of the system

`apps/api/src/plugins/auth.ts:44` re-resolves the principal **from the database on every request** — platform roles, restaurant memberships, driver status, user status, session revocation. The token is identity only; authority is never trusted from its claims.

Consequences, all verified in code:
- A revoked session invalidates access tokens immediately (`:66`)
- A suspended user is rejected (`:57`)
- A soft-deleted user is rejected (`:56`)
- A suspended driver keeps customer identity but loses Driver Mode (`:97`)

### Guard coverage

Every route file's auth-guard count matches its endpoint count. The five files with fewer guards are public by design and correctly so: `catalog.ts`, `geography.ts` (public browsing), `assets.ts` (public image read, authed upload), `auth.ts` / `portal-auth.ts` (login endpoints).

### Rate limiting

Applied selectively where abuse matters: driver applications 5/hour, asset upload 30/10min, portal login 10/5min, password reset 5/10min, restaurant activation 6/hour, support 10/hour.

### Idempotency

Mandatory on order creation (`apps/api/src/routes/orders.ts:156`), stored and replayed. A mobile network timing out cannot duplicate an order.

### Validation

Zod schemas in 30 of 40 route files. The other ten are parameterless GETs.

---

## 9. Database

71 tables, 141 foreign keys, 94 indexes, 17 migrations.

**Referential integrity:** 61 `cascade`, 42 `restrict`, 38 `set null` — a deliberate mix, not a default.

Answers to the consistency questions:

| Question | Answer |
|----------|--------|
| Order without customer? | No — FK `restrict` |
| Order without restaurant? | No — FK `restrict` |
| Assign a non-existent driver? | No — FK + membership check |
| Delete a restaurant with orders? | No — `restrict` |
| Delete a customer with orders? | No — customer deletion is **anonymization**, not a row delete |

Orders carry **snapshots** (`deliveryAddressSnapshotJson`, `restaurantLocationSnapshotJson`, `customerNameSnapshot`, `customerPhoneSnapshot`), so deleting an address or renaming a restaurant cannot corrupt order history.

**Database-level invariants** are asserted by the e2e suite (`apps/api/src/__tests__/order-lifecycle.e2e.test.ts`, 788 lines): commission cannot accrue twice, COD cannot be collected twice, one order cannot appear in two settlements, inventory cannot oversell the last unit, a city/governorate pair stays consistent, the outbox event is written in the same transaction as the state change.

---

## 10. Authentication & Authorization

| Control | Status |
|---------|--------|
| Password hashing | ✅ Argon2 (`@node-rs/argon2`) |
| User enumeration defence | ✅ Constant-time dummy hash (`apps/api/src/routes/portal-auth.ts:230`) |
| OTP hashing | ✅ Salted, expiring, attempt-counted |
| MFA (TOTP) | ✅ Built — enrolment, recovery codes, lockout, step-up |
| MFA for sensitive ops | ✅ Step-up required for 5 permissions |
| **MFA mandatory for admins** | ❌ **Off by default** — see SEC-1 |

Step-up-required permissions (`packages/contracts/src/permissions.ts:238`): `finance.settlement.void`, `finance.adjustment.create`, `restaurant.commission.update`, `roles.manage`, `customer.phone.unmask`.

---

## 11. Orders & Delivery Flow

### Real statuses

`PLACED → PENDING_RESTAURANT → ACCEPTED → PREPARING → READY → OUT_FOR_DELIVERY → DELIVERED → COMPLETED`, plus `REJECTED` and `CANCELLED` (`packages/contracts/src/enums.ts:130`).

### Who may perform each transition

Declared once, in a table, with the permitted actors (`packages/contracts/src/state-machines.ts:30`):

| From → To | Allowed actors | Reason required |
|-----------|----------------|-----------------|
| PLACED → PENDING_RESTAURANT | SYSTEM | |
| PENDING_RESTAURANT → ACCEPTED | RESTAURANT, ADMIN | |
| PENDING_RESTAURANT → REJECTED | RESTAURANT, ADMIN | ✅ |
| ACCEPTED → PREPARING / READY | RESTAURANT, ADMIN | |
| PREPARING → READY | RESTAURANT, ADMIN | |
| READY → OUT_FOR_DELIVERY | **DRIVER**, ADMIN | |
| OUT_FOR_DELIVERY → DELIVERED | **DRIVER**, ADMIN | |
| DELIVERED → COMPLETED | SYSTEM, ADMIN | |
| PLACED / PENDING_RESTAURANT → CANCELLED | **CUSTOMER**, ADMIN, SYSTEM | ✅ |
| ACCEPTED → CANCELLED | RESTAURANT, ADMIN | ✅ |
| PREPARING / READY / OUT_FOR_DELIVERY → CANCELLED | **ADMIN only** | ✅ |

**Enforcement is real, not advisory.** `assertTransition` (`packages/contracts/src/state-machines.ts`) rejects an unknown transition *and* a wrong actor, and is called from `apps/api/src/services/order-service.ts:519` inside a transaction that:

1. `SELECT ... FOR UPDATE` locks the order row
2. Checks `expectedVersion` → `ORDER_ALREADY_UPDATED` on a stale write
3. Asserts the transition
4. Bumps `version`
5. Writes `orderStatusHistory`
6. Enqueues an outbox event — same transaction

**No endpoint accepts a raw status.** Answers to the specific questions asked:

- Can a customer forge a status? **No.**
- Can a restaurant perform a transition it does not own? **No** — `FORBIDDEN` with `allowedActors` in the details.
- Can a driver touch an order not assigned to them? **No** — `assertOwnsAssignment`.
- Can an order be changed after acceptance? Only along declared paths.
- Restaurant rejects? → `REJECTED`, reason mandatory, customer + admin notified (notification dead — P0-1).
- No driver available? Order sits at `READY`. **There is no timeout or escalation.** — see HIGH-4.
- Internet drops mid-order? Idempotency key resolves it; no duplicate order.

---

## 12. Location / GPS / Maps

**This is the cleanest part of the system, and it is worth stating plainly: there is no tracking anywhere.**

### Permissions declared

`apps/mobile/app.config.ts:389` — Android: `POST_NOTIFICATIONS`, `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`.
`apps/mobile/app.config.ts:355` — iOS: `NSLocationWhenInUseUsageDescription` only.

### Verified absent

Searched the whole mobile app for `ACCESS_BACKGROUND_LOCATION`, `UIBackgroundModes`, `watchPositionAsync`, `startLocationUpdatesAsync`, `expo-task-manager`, `expo-background-*`:

**Zero results.** No background location. No continuous tracking. No location task manager.

### Driver heartbeat carries no location

`POST /api/v1/driver/heartbeat` (`apps/api/src/routes/driver.ts`) writes exactly one column:

```ts
.set({ lastHeartbeatAt: new Date() })
```

No coordinates. **Drivers are not tracked at all**, by design (ADR-0005).

### Where location is used — once

Foreground only, when the customer taps «تحديد موقعي» while saving a delivery address (`apps/mobile/src/lib/location.ts`). Accuracy `Balanced`, not `Highest`. A fix outside Iraq's bounding box is rejected rather than stored (`IRAQ_BOUNDS`, `location.ts:44`) — a failed GPS emulator cannot write an Atlantic coordinate onto an address.

### Storage and access

Coordinates live in two tables only: `user_addresses` and `restaurant_branches` (`packages/db/src/schema/identity.ts`, `restaurants.ts`).

| Who | Sees customer coordinates | When |
|-----|---------------------------|------|
| Customer | Own addresses | Always |
| Driver | One address | Only for their own assignment, after `assertOwnsAssignment` (`driver.ts:365`) |
| Restaurant | Address snapshot on its own orders | Own orders only |
| Admin | Via order detail | Permission-gated |

Coordinates are **not** used for analytics. There is no analytics SDK in the binary.

### Maps

**Leaflet in a WebView** (`apps/mobile/src/ui/map-picker.tsx`) — no native Maps SDK, no Google/Mapbox key, no billing account. This is also why the app is small.

- Leaflet is loaded from a CDN **with Subresource Integrity digests** on both files (`map-picker-html.ts:78,116`) — a changed byte means the script does not run.
- WebView hardened: `originWhitelist={['about:blank']}`, `onShouldStartLoadWithRequest` rejects navigation, `setSupportMultipleWindows={false}`.
- No geocoding, no reverse geocoding, no Directions, no Places, no Distance Matrix. Navigation is a handoff link to the driver's own maps app.

**❌ P0-6:** With `EXPO_PUBLIC_MAP_TILE_URL` unset the document falls back to `tile.openstreetmap.org`, which the OSMF Tile Usage Policy explicitly forbids a distributed application from using. Not a technical failure — a licence one.

**No API secrets were found in the repository.** Nothing to redact.

---

## 13. Notifications

### 🔴 P0-1 — Push notifications do not work, and report success

**Evidence, three independent confirmations:**

**1. The worker hardcodes the stub provider and ignores the config.**
```
apps/worker/src/index.ts:93
const ctx: WorkerContext = { env, db, redis, logger, push: new ConsolePushProvider(logger) };
```
There is no branch on `env.PUSH_PROVIDER`. It is never read.

**2. Only the stub exists.** `PUSH_PROVIDER` accepts `['console','expo','fcm']` (`packages/config/src/env.ts:284`) — but grep for provider classes in `packages/notifications/src/index.ts` returns `ConsolePushProvider` (`:755`), `sms_gateway` (`:133`), `whatsapp` (`:491`). **There is no `ExpoPushProvider` and no `FcmPushProvider`.** Setting `PUSH_PROVIDER=expo` would change nothing.

**3. The stub logs and claims success.**
```
packages/notifications/src/index.ts:760-766
async send(message: PushMessage): Promise<PushResult> {
  this.logger.info({ event: 'push.send', ... }, 'Push dispatched (console provider)');
  return { ok: true };
}
```

**And the failure is then recorded as a success:**
```
apps/worker/src/jobs/outbox-publisher.ts:204-207
status: results.some((r) => r.ok) ? 'SENT' : 'FAILED',
sentAt: new Date(),
```

The `notification_deliveries` row says `SENT`. The admin dashboard will show it as sent. Nothing left the server. **There is no signal anywhere that this is broken.**

**Deployed configuration confirms it is live:** `render.yaml:189` — `PUSH_PROVIDER: console`.

### What still works

The mobile side is complete and correct: token registration, `POST /api/v1/devices`, foreground handler, tap-to-open-order, Android channel. The break is entirely the last hop.

**Degradation:** mobile falls back to polling — customers 20 s, drivers 30 s. Orders still flow. But a customer gets no alert that their food is ready, and **a driver gets no alert that a delivery was assigned to them.**

### Event → audience matrix

From `packages/contracts/src/events.ts:196`. **Every row below is currently dead except the restaurant column**, which is served by WebSocket rather than push.

| Event | Customer | Restaurant | Driver | Admin |
|-------|:--------:|:----------:|:------:|:-----:|
| order.placed | | ✅ | | ✅ |
| order.accepted | ✅ | ✅ | | |
| order.rejected | ✅ | ✅ | | ✅ |
| order.preparing | ✅ | ✅ | | |
| order.ready | ✅ | ✅ | ✅ | |
| order.out_for_delivery | ✅ | ✅ | | |
| order.delivered | ✅ | ✅ | | |
| order.completed | ✅ | ✅ | | ✅ |
| order.cancelled | ✅ | ✅ | | ✅ |
| delivery.assigned | | ✅ | ✅ | |
| delivery.accepted / rejected | | ✅ | | |
| delivery.picked_up / arrived | ✅ | ✅ | | |
| delivery.reassigned | | ✅ | ✅ | |
| inventory.low_stock | | ✅ | | |
| settlement.* | | ✅ | | ✅ |
| restaurant.approved / rejected / suspended | | ✅ | | ✅ |

### 🔴 P0-5 — Android has no FCM credentials

No `google-services.json` in the repository; `android.googleServicesFile` is read conditionally from `GOOGLE_SERVICES_JSON` (unset). Android push cannot work even after P0-1 is fixed. iOS needs nothing in the repo — EAS holds the APNs key.

### Realtime (the part that works)

WebSocket over Redis pub/sub (`apps/api/src/realtime/gateway.ts`). **Consumed only by the restaurant portal** (`apps/restaurant-web/src/components/live-board.tsx`, `hooks/use-realtime.ts`). Neither the mobile app nor the admin portal subscribes.

---

## 14. Security Audit

### Tested for, and not found

| Class | Result |
|-------|--------|
| IDOR — restaurant | ❌ Not found — `restaurantScope()` on every route |
| IDOR — driver | ❌ Not found — `assertOwnsAssignment` before read and write |
| Role escalation via token claims | ❌ Not possible — roles re-read from DB per request |
| Client-side-only authorization | ❌ Not found — portal permissions shape UI only; server re-checks |
| Exposed admin/restaurant/driver APIs | ❌ Not found — all guarded |
| Price manipulation | ❌ Not possible — server recalculates |
| Order status forgery | ❌ Not possible — transition table + actor check |
| Hardcoded secrets | ❌ None — history scanned clean |
| Debug / mock / bypass endpoints | ❌ None reachable in production |
| Stored XSS via upload | ❌ SVG rejected by design (`asset-service.ts:23`) |
| User enumeration | ❌ Constant-time dummy hash |

### SEC-1 — MFA is off by default for platform admins · **HIGH**

**Evidence:** `apps/api/src/services/config-service.ts:24` — `require_mfa: false`.

`MFA_MANDATORY_ROLES = ['SUPER_ADMIN','FINANCE_ADMIN']` (`packages/contracts/src/permissions.ts:247`) is **advisory** — it is read only to decide whether to *offer* MFA (`apps/api/src/routes/mfa.ts:86`), not to require it.

A SUPER_ADMIN can therefore sign in with a password alone, and that account can unmask customer phone numbers, void settlements and change commissions. The MFA implementation is good; it is simply not switched on.

**Fix:** set `require_mfa` true and enrol admin accounts before launch.

### SEC-2 — `app.json` was created at the repo root · **LOW** · *(introduced by the prior fix session, since removed)*

An empty `{"expo":{}}` was generated by `expo install --fix` and deleted during that session. Not present at `274e856`. Noted only so it is not re-introduced.

### SEC-3 — Un-gated QA route in the restaurant portal · **LOW**

`apps/restaurant-web/src/app/alert-test/page.tsx` ships to production with no gate. It is a deliberate onboarding harness (plan §181/§122) that drives the real alert manager and touches no data. **Not a leak** — noted for completeness.

### SEC-4 — Audit log retains a deleted customer's phone number · **LOW / privacy**

`apps/api/src/routes/profile.ts` — on deletion, `beforeJson: { phone_e164, had_name }` is written to `audit_logs`. The stated reason is support matching for past orders. Legitimate, but it **must be declared** in your retention policy, because the user was told their data was deleted.

### Dependency vulnerabilities

`pnpm audit`: **zero advisories reach the shipped mobile binary.** The remaining `uuid` finding is build-time only (`expo > @expo/config-plugins > xcode`). `drizzle-orm` (HIGH) affects `apps/api` — **not the app, but the server holding customer phone numbers and home addresses. Do not leave it.**

---

## 15. Privacy Audit

| Data | Collected by | Why | Stored | Who can read | Shared |
|------|-------------|-----|--------|--------------|--------|
| Phone number | Customer app | Account identity, courier contact | `users.phone_e164` | Self, assigned driver, restaurant (own orders), admin (gated) | No |
| Name | Customer app | Order attribution, door delivery | `users.full_name` + order snapshot | Same | No |
| Delivery address | Customer app | Delivery | `user_addresses` + order snapshot | Same | No |
| Precise coordinates | Customer app, once, foreground | Delivery pin | `user_addresses.lat/lon` | Same | No |
| Order history | System | Operations, finance | `orders` | Self, restaurant, admin | No |
| Push token | Mobile | Notification routing | `user_devices` | System | No (Expo/FCM once wired) |
| Driver plate / vehicle / photo | Driver | Operational identification | `drivers` | Admin, own restaurant | No |
| IP | API | Rate limiting | `otp_challenges`, `login_attempts` | System | No |
| Payment data | **None** | COD only | — | — | — |

**No advertising SDK. No third-party analytics. No device fingerprinting. No tracking.**

Therefore **App Tracking Transparency does not apply** and `NSUserTrackingUsageDescription` must **not** be added.

**Retention: NOT VERIFIED.** No retention or purge policy was found for `audit_logs`, `login_attempts`, `otp_challenges`, or completed orders. Both stores' data-safety forms ask about this.

---

## 16. Apple App Store Audit

### APPLE-001 · **CRITICAL** · Privacy policy and terms do not resolve
- **Evidence:** `nslookup jibli.iq` → `Non-existent domain` (re-verified 19 Sep 2026)
- **File:** `apps/mobile/app.config.ts` — `privacyPolicyUrl`, `termsUrl`
- **Why Apple may reject:** 5.1.1 requires a functional privacy policy URL; 1.5 requires in-app support/legal links to work. «سياسة الخصوصية» in حسابي opens a dead link in front of the reviewer.
- **Aggravating factor:** the URL is evaluated at build time and **baked into the binary** — an OTA update cannot repair it.
- **Fix:** deploy `apps/legal` (built, not deployed), point DNS or set `EXPO_PUBLIC_PRIVACY_URL` / `EXPO_PUBLIC_TERMS_URL` in **both** `eas.json` profiles before building.
- **Mitigation already in place:** `app.config.ts` now throws on a production build with the placeholder, so this cannot ship silently.

### APPLE-002 · **CRITICAL** · Reviewer cannot sign in
- **Evidence:** `render.yaml:169` — `OTP_PROVIDER: console`; `render.yaml:185` — `OTP_TEST_PHONES: '+9647712345678'`
- **Why Apple may reject:** 2.1 — a reviewer without an Iraqi number cannot get past the first screen.
- **Fix:** keep `OTP_TEST_PHONES` through review and state the number + fixed code in App Review Notes.

### APPLE-003 · **HIGH** · API sleeps; cold start ~60 s
- **Evidence:** Render free plan; `apps/mobile/src/lib/api.ts:189` exists specifically to absorb 502/503/504 during wake-up
- **Why Apple may reject:** 2.1 — reviewer opens a cold app, sees an empty list.
- **Fix:** paid plan for at least the review window.

### APPLE-004 · **MEDIUM** · Notifications advertised but non-functional
- **Evidence:** P0-1
- **Why Apple may reject:** 2.3.1 (hidden/non-functional features) or 2.1. The app requests notification permission and delivers nothing.
- **Fix:** implement a real provider, or do not request the permission.

### Satisfied

| Guideline | Status | Evidence |
|-----------|--------|----------|
| 5.1.1(ii) — no forced registration | ✅ | Guest state; sign-in only at checkout |
| 5.1.1(v) — in-app account deletion | ✅ | `(tabs)/account.tsx` → `DELETE /api/v1/profile` |
| 4.8 — third-party login parity | ✅ | No third-party login enabled |
| 2.5.x — export compliance | ✅ | `ITSAppUsesNonExemptEncryption: false` |
| 5.1.2 — purpose strings | ✅ | Arabic, names the one screen |
| Privacy manifest | ✅ | `ios.privacyManifests`, `NSPrivacyTracking: false` |
| Location minimisation | ✅ | Foreground only, one use |
| ATT | ✅ n/a | No tracking |

---

## 17. Google Play Audit

### GOOGLE-001 · **CRITICAL** · Privacy policy + account-deletion URL do not resolve
- Same root cause as APPLE-001. Play additionally requires a **web** account-deletion page.
- `apps/legal/src/app/delete-account/page.tsx` **exists and is built** — it is simply not deployed.

### GOOGLE-002 · **CRITICAL** · No FCM credentials
- **Evidence:** no `google-services.json`; `GOOGLE_SERVICES_JSON` unset
- Android push cannot function.

### GOOGLE-003 · **HIGH** · Data Safety form will be inaccurate
- The form must declare location, phone, name, order history. Notifications must not be declared as working while P0-1 stands.

### GOOGLE-004 · **HIGH** · Closed testing requirement · **REQUIRES EXTERNAL CONSOLE VERIFICATION**
- If the Play account is a **personal account created on or after 13 November 2023**, production access requires **12 testers, continuously opted in, for 14 days**, then an application.
- **I cannot determine the account type from the repository.** Check Play Console. This is the longest item on the calendar — start it first.

### Satisfied

| Requirement | Status |
|-------------|--------|
| Target API 36 | ✅ Expo SDK 57 |
| AAB upload format | ✅ `eas.json` `buildType: app-bundle` |
| No background location | ✅ Verified absent |
| Least-privilege permissions | ✅ Three permissions |
| In-app account deletion | ✅ |

---

## 18. Android Build Audit

| Item | Value | Source |
|------|-------|--------|
| applicationId | `iq.jibli.app` | `app.config.ts` |
| versionName | `1.0.0` | `app.config.ts` |
| versionCode | EAS remote, `autoIncrement: true` | `eas.json` |
| targetSdk / compileSdk | 36 (from Expo SDK 57) | not restated in config |
| Signing | EAS-managed | **NOT VERIFIED** — requires EAS |
| Release type | AAB | `eas.json` |
| ProGuard / R8 | Expo default | **NOT VERIFIED** |
| Permissions | 3 | `app.config.ts:389` |
| Edge-to-edge | Enforced by API 36; tab bar now uses real insets | `(tabs)/_layout.tsx` |

**`expo-doctor`: 21/21 checks passed.**

---

## 19. iOS Build Audit

| Item | Value |
|------|-------|
| Bundle ID | `iq.jibli.app` |
| Version / Build | `1.0.0` / EAS remote |
| supportsTablet | `false` |
| Orientation | portrait |
| Info.plist | `ITSAppUsesNonExemptEncryption: false`, `CFBundleAllowMixedLocalizations: true`, `CFBundleLocalizations: ['ar','en']`, `NSLocationWhenInUseUsageDescription` |
| Privacy manifest | Present — `NSPrivacyTracking: false`, 4 collected types, `CA92.1` |
| Background modes | **None** |
| Associated domains | **None** — no Universal Links |
| URL scheme | `jibli` |
| Push capability | Requires APNs key on EAS — **NOT VERIFIED** |
| Signing / archive | **NOT VERIFIED — REQUIRES APPLE DEVELOPER ACCESS** |

---

## 20. Application Size

### Measured — JavaScript bundle + bundled assets

`npx expo export -p android -p ios`, clean, this session:

| | Android | iOS |
|---|---|---|
| Hermes bytecode | **3.52 MB** | **3.43 MB** |
| Bundled assets | **0.50 MB** | **0.50 MB** |
| **Total JS payload** | **4.01 MB** | **3.93 MB** |

For reference, before the prior session's optimisation: Android 6.53 MB, iOS 5.32 MB.

### What drives the remaining payload

Source-map attribution across 1,624 modules:

| Share | Size | Package |
|---|---|---|
| 33.4% | 2,064 KB | `react-native` — framework floor |
| 19.1% | 1,183 KB | `expo-router` |
| 10.6% | 657 KB | application source (~24k lines) |
| 4.0% | 249 KB | `react-native-svg` |
| 2.5% | 152 KB | `@react-native/virtualized-lists` |
| 2.4% | 146 KB | `zod` |
| 2.1% | 129 KB | `react-native-worklets` |
| 0.9% | 57 KB | `expo-auth-session` — Google sign-in, currently disabled |

Assets are now almost entirely fonts: 5 Cairo weights (~484 KB) + subsetted icon font (16.8 KB).

### 🔴 Native binary size: **NOT VERIFIED — REQUIRES BUILD ACCESS**

I will not give you a number I did not measure.

**Why it could not be measured here:**
- React Native 0.86 ships **no** prebuilt `.so` or `.aar` in `node_modules` — verified by scanning the pnpm store. They are fetched from Maven at build time.
- The local Android SDK has platform `android-34` only; the app targets 36.
- `expo prebuild` would generate an `android/` directory — a project modification, which you excluded.
- No macOS, so no iOS archive is possible at all.

**To get real numbers:**
```sh
cd apps/mobile
eas build -p android --profile production   # AAB
eas build -p ios --profile production       # IPA
```
Then read App Store Connect (iOS download size per device) and Play Console (Android download size per ABI/density).

---

## 21. Performance

### Measured / verified

| Item | Finding |
|------|---------|
| Order polling | 20 s customer, 30 s driver — **only while an order is live**, `false` otherwise (`order-watch.tsx:180`, `delivery.tsx:593`) |
| Background polling | Fixed — `focusManager` now bound to `AppState` (`network.tsx`) |
| Request timeouts | Fixed — 15 s read / 30 s write (`api.ts`) |
| Search debounce | 300 ms |
| Image caching | `expo-image`, `memory-disk`, `recyclingKey` |
| Driver location polling | **None — no location is ever sent** |

### PERF-1 · Home screen is not virtualised · **MEDIUM**

`apps/mobile/src/app/(tabs)/index.tsx:353` renders every restaurant with `.map()` inside a `ScrollView`. The only `FlatList` in the app is the banner carousel. `GET /restaurants` has no pagination.

Fine at current volume ("tens of rows", per the code's own comment). At 80–100 merchants on a low-end Android phone — the dominant device class in Iraq — this becomes a visible freeze on open.

### PERF-2 · Images served at original size from Postgres, no CDN · **MEDIUM**

`apps/api/src/routes/assets.ts:85-112` streams bytes from Postgres through the app server. No resizing, no variants, no CDN. Ceiling 5 MB per image (`asset-service.ts:46`).

Mitigated in practice — the portal downscales in the browser before upload, and `Cache-Control: immutable` for a year makes the second load free. But **the limit is convention, not enforcement**: there is no server-side dimension cap.

### PERF-3 · Cart written to Keystore on every tap · **LOW**

`apps/mobile/src/lib/cart.tsx:60` persists the whole cart through `expo-secure-store` on every change. A Keystore write costs 10–50 ms on Android. Also: the cart is not a secret, and the project's own policy limits Keystore to tokens and PINs.

---

## 22. Network / Offline

| Scenario | Behaviour |
|----------|-----------|
| No internet | `onlineManager` bound to NetInfo; banner «لا يوجد اتصال بالإنترنت»; cached data still renders |
| Slow internet | 15 s / 30 s timeouts → `NetworkError` with an Arabic message |
| API cold start (502/503/504) | Up to 2 retries with 4 s / 8 s backoff — **GET only** |
| Server 5xx unparseable | Mapped to `SERVICE_UNAVAILABLE`, not a generic error |
| Expired token | Single-flight refresh, request replayed once |
| Session revoked | Signed out, no retry loop |
| GPS unavailable / denied | `denied` / `disabled` / `unavailable` — «اكتب العنوان يدوياً» |
| Map/CDN unreachable | ⚠️ Spinner ends, grey panel, **no error message** — see HIGH-5 |

**Can an order be created twice by a retry?** **No.** Idempotency key is mandatory, generated once per checkout (`checkout.tsx:49`), stored and replayed. Writes are explicitly excluded from cold-start retry.

---

## 23. Mock vs Real Data

**Every production screen reads real backend data.** A repository-wide scan for `mock`, `dummy`, `fake`, `seed`, `placeholder`, hardcoded arrays found no mock data in any user-facing path.

The only matches are legitimate:

| Match | Verdict |
|-------|---------|
| `OTP_PROVIDER=mock` | Dev config; env schema refuses it in production |
| `ioredis-mock` | Dev fallback only |
| `DUMMY_ARGON2_HASH` | **Security feature** — constant-time comparison |
| `alert-test` page | Deliberate onboarding harness, drives the real alert manager |

**Known incomplete (honest placeholders, not fake data):**
- Product photo upload in mobile Owner Mode — `apps/mobile/src/app/(owner)/product/[id].tsx:374`. Needs `expo-image-picker`, not installed. The UI shows an explanatory slot, **not a dead button**. The restaurant portal can upload.

---

## 24. Production Configuration

### 🔴 P0-2 — The deployed API is not in production mode

```
render.yaml:70   APP_ENV: staging
render.yaml:169  OTP_PROVIDER: console
render.yaml:185  OTP_TEST_PHONES: '+9647712345678'
render.yaml:189  PUSH_PROVIDER: console
```

`APP_ENV=staging` means **every production guard in `packages/config/src/env.ts:313-354` is bypassed** — real Redis, real OTP provider, real push provider, database TLS, no test phones, no localhost CORS.

**Consequence: exactly one phone number in the world can sign in.** `console` generates a real code and hands it to a provider that logs *that* an SMS was sent, never the code.

The config file documents this honestly and explains the ordering constraint. It is nonetheless the state of the deployment.

### Localhost fallbacks

All localhost references are `?? 'http://localhost:...'` defaults when an env var is unset — no hardcoded dev URL. **But:**

`apps/admin-web/src/lib/api.ts:25` and `apps/restaurant-web/src/lib/api.ts:25` fall back to `http://localhost:4000`. If `NEXT_PUBLIC_API_URL` is not set on Vercel, **the portals silently call localhost and every screen fails.** — **REQUIRES EXTERNAL CONSOLE VERIFICATION** (Vercel project settings).

Mobile is safe: falls back to `extra.apiUrl`, which is the deployed API.

### Secrets

**None committed.** `git log --all --diff-filter=A` for `.env`, `.p8`, `.p12`, keystores: clean. Live-key pattern scan: only documentation examples (`sk_live_xxx`).

---

## 25. BLOCKERS — MUST FIX BEFORE STORE SUBMISSION

### P0-1 · Push notifications are a no-op and report success
- **Evidence:** `apps/worker/src/index.ts:93` hardcodes `ConsolePushProvider`, ignoring `PUSH_PROVIDER`. No Expo or FCM provider class exists in `packages/notifications/src/index.ts`. `ConsolePushProvider.send` returns `{ok: true}` (`:765`), and `outbox-publisher.ts:204` records `SENT`.
- **Impact:** every notification in the matrix is dead except the restaurant's WebSocket path. Drivers are not alerted to assignments. Failure is invisible in the dashboard.
- **Fix:** implement `ExpoPushProvider` (the mobile app already uses Expo push tokens), branch on `env.PUSH_PROVIDER` in `apps/worker/src/index.ts`, set `PUSH_PROVIDER=expo`. Add a test asserting the console provider is never selected outside development.

### P0-2 · Deployed API is in staging mode; one phone can sign in
- **Evidence:** `render.yaml:70,169,185`
- **Fix:** switch `OTP_PROVIDER` to `sms_gateway` (OTPIQ config is documented in `docs/operations/store-submission.md`), verify `OTP_PHONE_ALLOWLIST` is empty, keep `OTP_TEST_PHONES` through review, then move `APP_ENV` to `production` as a separate later step.

### P0-3 · `jibli.iq` has no DNS — legal links dead and baked into the binary
- **Evidence:** `nslookup jibli.iq` → NXDOMAIN, 19 Sep 2026
- **Fix:** deploy `apps/legal` to Vercel (Root Directory `apps/legal`), then either point DNS or set `EXPO_PUBLIC_PRIVACY_URL` / `EXPO_PUBLIC_TERMS_URL` in **both** `eas.json` build profiles **before** building.

### P0-4 · API sleeps on a free plan
- **Evidence:** cold-start retry logic exists specifically for this (`apps/mobile/src/lib/api.ts:189`)
- **Fix:** paid Render plan for `jibli-api` at minimum through the review window.

### P0-5 · No FCM credentials for Android
- **Evidence:** no `google-services.json`; `GOOGLE_SERVICES_JSON` unset
- **Fix:** `eas credentials -p android` and upload an FCM v1 service-account key.

### P0-6 · Default map tiles violate the OSMF usage policy
- **Evidence:** `apps/mobile/src/ui/map-picker-html.ts:47`
- **Fix:** set `EXPO_PUBLIC_MAP_TILE_URL` and `EXPO_PUBLIC_MAP_TILE_ATTRIBUTION` to a keyed provider (MapTiler / Stadia free tiers are far above this app's ~45 tiles per address session).

---

## 26. HIGH PRIORITY — FIX BEFORE LAUNCH

### HIGH-1 · MFA off by default for platform admins
`config-service.ts:24` — `require_mfa: false`. A SUPER_ADMIN password alone reaches customer phone numbers, settlement voids and commission changes. The MFA system is built; turn it on.

### HIGH-2 · No crash reporting
`apps/mobile/src/lib/error-boundary.tsx:38` writes `console.error`, which goes nowhere in a release build. You will launch blind. This matters more here than usual because `expo-updates` is configured — your ability to ship a fix is excellent; what is missing is knowing *what* to fix.

### HIGH-3 · `drizzle-orm` HIGH advisory in the API
Not in the app bundle, but in the server holding customer phone numbers and home addresses.

### HIGH-4 · No timeout or escalation when no driver is available
An order sits at `READY` indefinitely if the restaurant never assigns a driver. No SLA timer, no admin alert, no auto-escalation found. Operationally this is how an order goes cold with nobody noticing.

### HIGH-5 · Map failure is silent
`apps/mobile/src/ui/map-picker.tsx` — if the Leaflet CDN or tile server is unreachable, `onLoadEnd` fires, the spinner clears, and the customer sees a grey panel with no explanation. No `onError` / `onHttpError` handling.

### HIGH-6 · Portal API URL falls back to localhost
`apps/admin-web/src/lib/api.ts:25`, `apps/restaurant-web/src/lib/api.ts:25`. Verify `NEXT_PUBLIC_API_URL` is set in both Vercel projects. **REQUIRES EXTERNAL CONSOLE VERIFICATION.**

### HIGH-7 · Play closed-testing requirement
**REQUIRES EXTERNAL CONSOLE VERIFICATION.** If the account is personal and created on/after 13 Nov 2023: 12 testers, continuously opted in, 14 days. Start immediately — it runs in parallel with everything else.

### HIGH-8 · Data retention policy undefined
No purge policy for `audit_logs`, `login_attempts`, `otp_challenges`, or completed orders. Both stores' data-safety forms ask. Note that a deleted customer's phone number persists in `audit_logs`.

---

## 27. MEDIUM PRIORITY

- **MED-1** — Home screen not virtualised; `GET /restaurants` unpaginated (PERF-1)
- **MED-2** — Images served full-size from Postgres, no CDN, no server-side dimension cap (PERF-2)
- **MED-3** — Mobile test coverage thin: 8 test files for ~79 source files; no component or navigation tests
- **MED-4** — Owner Mode product photo upload not wired (`expo-image-picker` absent)
- **MED-5** — e2e suite could not be run: database on port 5440 not listening. **NOT VERIFIED**

---

## 28. POST-LAUNCH

- Universal Links / App Links (no `associatedDomains`, no `intentFilters`) — needs real web content first
- Cart → `AsyncStorage` instead of Keystore (PERF-3)
- Automatic driver dispatch (currently manual by restaurant — may be the intended model)
- Driver document collection (ID, licence, bank) if your operation requires it
- Admin realtime — admin portal does not subscribe to WebSocket
- Icon-font regeneration is manual (`pnpm icons:build`), guarded by a test

---

## 29. Exact Fix List

| P | ID | Action | Where |
|---|----|--------|-------|
| P0 | 1 | Implement `ExpoPushProvider`; branch on `env.PUSH_PROVIDER` | `apps/worker/src/index.ts:93`, `packages/notifications/src/index.ts` |
| P0 | 2 | Switch OTP to `sms_gateway`; verify allowlist empty | `render.yaml:169` |
| P0 | 3 | Deploy `apps/legal`; set privacy/terms URLs in both profiles | Vercel + `apps/mobile/eas.json` |
| P0 | 4 | Move `jibli-api` off the free plan | Render |
| P0 | 5 | Upload FCM v1 credentials | `eas credentials -p android` |
| P0 | 6 | Set tile provider URL + attribution | `apps/mobile/eas.json` |
| P1 | 7 | Set `require_mfa` true; enrol admins | `config-service.ts:24` |
| P1 | 8 | Add crash reporting | `error-boundary.tsx:38` |
| P1 | 9 | Patch `drizzle-orm` | `apps/api` |
| P1 | 10 | Add SLA timer / admin alert for unassigned `READY` orders | `apps/worker` |
| P1 | 11 | Add `onError` to the map WebView | `map-picker.tsx` |
| P1 | 12 | Verify `NEXT_PUBLIC_API_URL` in both Vercel projects | Vercel |
| P1 | 13 | Start Play closed testing | Play Console |
| P1 | 14 | Define retention policy | Docs + worker job |
| P2 | 15 | `FlatList` + pagination for merchants | `(tabs)/index.tsx:353` |
| P2 | 16 | Thumbnail variants or CDN for assets | `apps/api/src/routes/assets.ts` |
| P2 | 17 | Mobile component tests | `apps/mobile` |
| P3 | 18 | Universal Links / App Links | `app.config.ts` |

---

## 30. Test Matrix

Static verification. **No runtime end-to-end run was possible** — the e2e database (port 5440) is not running, and running it would write to your database, which you excluded.

| Flow | Customer | Restaurant | Driver | Admin | Result |
|------|----------|------------|--------|-------|--------|
| Registration | ✅ OTP | ✅ Application + activation | ✅ Apply → activate | ✅ Staff invite | **Code-complete; blocked by P0-2** |
| Login | ✅ OTP | ✅ Password + MFA | ✅ Password | ✅ Password + MFA | **PASS** (MFA off — HIGH-1) |
| Location | ✅ Foreground, once | ✅ Branch coords | n/a — not tracked | ✅ Coverage admin | **PASS** |
| Order create | ✅ Server-priced, idempotent | n/a | n/a | n/a | **PASS** |
| Status transitions | ✅ Cancel (early only) | ✅ Accept/Prepare/Ready | ✅ Pickup/Deliver | ✅ All + override | **PASS** |
| Notification | ❌ Dead | ✅ WebSocket + audio | ❌ Dead | ❌ Dead | **FAIL — P0-1** |
| Cancellation | ✅ Before acceptance | ✅ After acceptance | n/a | ✅ Any state | **PASS** |
| History | ✅ | ✅ | ✅ | ✅ | **PASS** |

---

## 31. Final Table

| Area | Current Status | Critical Issues | Must Fix Before Launch |
|------|---------------|-----------------|------------------------|
| Customer App | Functional | Push dead | P0-1, P0-3 |
| Restaurant | Functional | — | — |
| Driver | Functional | Not alerted to assignments | P0-1, P0-5 |
| Admin | Functional | MFA off | HIGH-1 |
| Backend | Functional | Staging config | P0-2, P0-4 |
| Database | Complete | — | Retention policy |
| Authentication | Strong | MFA not mandatory | HIGH-1 |
| Orders | Complete + enforced | No unassigned-order escalation | HIGH-4 |
| Location | Minimal, clean | — | — |
| Maps | Functional | Tile licence | P0-6 |
| Notifications | **Broken** | Silent no-op reported as SENT | **P0-1, P0-5** |
| Security | Strong | MFA off; `drizzle-orm` | HIGH-1, HIGH-3 |
| Privacy | Clean | Retention undefined | HIGH-8 |
| Android | Configured | No FCM | P0-5 |
| iOS | Configured | NOT VERIFIED (no Apple access) | — |
| Apple Store | **NOT READY** | Dead links, no sign-in, sleeping API | P0-2/3/4 |
| Google Play | **NOT READY** | Dead links, no FCM, closed testing | P0-3/5, HIGH-7 |

---

## 32. Direct Answers

**1. Is the app ready to launch?**
**No.** Six P0 blockers. None is a rewrite; all are configuration, credentials, deployment — except P0-1, which is roughly a day of real implementation.

**2. Top 5 to fix first?**
1. Push notification provider (P0-1) — a whole feature is dead and lies about it
2. Deploy `apps/legal` + set legal URLs (P0-3) — baked into the binary at build time
3. Real OTP provider (P0-2) — one phone number can currently sign in
4. FCM credentials (P0-5)
5. Paid API plan (P0-4)

**3. Is the Customer App complete?**
Functionally yes, end to end. Browse → cart → checkout → order → track → rate → delete account all work against real endpoints. **Blocked by push and legal URLs.**

**4. Is the Driver System complete?**
Yes, with correct authorization. Apply → activate → online/offline → assigned tasks → pickup → deliver → COD → cash handover → earnings. **Gap: without push, a driver only learns of an assignment by polling every 30 s with the app open.**

**5. Is the Restaurant System complete?**
Yes. The most complete surface in the platform — and the only role whose notifications work, because they ride WebSocket rather than push.

**6. Is the Admin Dashboard complete?**
Yes. 28 pages, all backend-connected. MFA is built but off.

**7. Is the Order lifecycle complete?**
Yes, and rigorously enforced: 10 statuses, declarative transition table with actor authorization, row locking, optimistic concurrency, status history, outbox events, idempotency.

**8. Is the Location implementation safe and compliant?**
**Yes — exemplary.** Foreground only, one use, permission requested at a moment that makes sense, out-of-country coordinates rejected, coordinates in two tables, exposure gated by assignment ownership, no analytics.

**9. Is there Background Location?**
**No.** Verified absent: no `ACCESS_BACKGROUND_LOCATION`, no `UIBackgroundModes`, no `watchPositionAsync`, no `startLocationUpdatesAsync`, no `expo-task-manager`. **Drivers are not tracked. The heartbeat sends a timestamp and nothing else.**

**10. Apple problems?**
Four. Two critical (dead privacy URL, reviewer cannot sign in), one high (sleeping API), one medium (notifications requested but non-functional).

**11. Google Play problems?**
Four. Two critical (dead URLs incl. web account deletion, no FCM), two high (Data Safety accuracy, closed-testing requirement).

**12. Security problems?**
No IDOR, no broken access control, no role escalation, no client-side-only authorization, no committed secrets, no price manipulation, no status forgery. **One real issue: MFA off by default for platform admins.** Plus a HIGH `drizzle-orm` advisory in the API.

**13. Android Release size?**
**JS payload measured: 4.01 MB** (3.52 MB bytecode + 0.50 MB assets).
**Final APK/AAB: NOT VERIFIED — REQUIRES BUILD ACCESS.** RN 0.86 fetches native artifacts from Maven at build time; the local SDK lacks platform 36; `prebuild` would modify the project.

**14. iOS Release size?**
**JS payload measured: 3.93 MB.**
**IPA/archive: NOT VERIFIED — REQUIRES macOS AND APPLE DEVELOPER ACCESS.**

**15. What stops us uploading today?**
Concretely: the privacy policy URL does not resolve and is baked into the binary; no real customer can sign in; the API sleeps; notifications do not work; Android has no FCM; and the map tiles violate a usage policy.

**16. What could ship now without fixes?**
Nothing to a public store. What **is** ready and could go to internal testers today: the restaurant portal, the admin portal, and the mobile app as a **preview APK** against the staging API, using the test phone number. The restaurant and admin surfaces are genuinely production-quality.

---

## Appendix — What was run

| Check | Result |
|-------|--------|
| `pnpm -r typecheck` | ✅ 0 errors, all packages |
| `pnpm lint` | ✅ clean |
| `pnpm vitest run` | ✅ 511 tests, 38 files |
| `npx expo-doctor@latest` | ✅ 21/21 |
| `npx expo export -p android -p ios` | ✅ 4.01 / 3.93 MB |
| `pnpm audit --json` | ✅ 0 reach the app binary |
| `nslookup jibli.iq` | ❌ NXDOMAIN |
| `npx expo config` (dev + simulated production) | ✅ dev passes; production correctly refuses placeholders |
| git history secret scan | ✅ clean |
| Native `.so`/`.aar` scan of pnpm store | ✅ confirmed none shipped |

**Not run:** EAS builds, iOS archive, e2e suite (database not running), any runtime device test.

**Requires external console verification:** Apple Developer / App Store Connect, Google Play Console (account type, closed testing), Firebase (FCM), Vercel (`NEXT_PUBLIC_API_URL`), Render (live env values), EAS credentials.
