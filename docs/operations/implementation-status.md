# Implementation status

Honest account of what is built, what is scaffolded, and what remains before the
pilot gate in plan §188. Written so the next engineer does not have to discover
the gaps by hitting them.

---

## The five pilot-blocking gaps — now addressed

| # | Gap | Resolution |
| --- | --- | --- |
| 1 | No realtime gateway | WebSocket gateway at `/api/v1/realtime` relaying the outbox via Redis pub/sub. Channels are granted from session membership, never requested by the client. Polling remains as a 60s safety net and tightens to 8s when the socket is down. |
| 2 | No MFA enrolment | Two-phase TOTP enrolment, recovery codes, replay protection, lockout. Verified against the RFC 6238 test vectors. Roles that mandate MFA cannot opt out. |
| 3 | Inventory not reserved at placement | `reserveInventoryForOrder` runs inside the PlaceOrder transaction with `FOR UPDATE` row locks taken in deterministic ID order. Release and consumption share one implementation. |
| 4 | No E2E tests | 13 end-to-end tests asserting the production-blocking invariants against real database constraints. |
| 5 | Sound unverified on real devices | `/alert-test` harness driving the real alert manager, with an 8-point checklist and a copyable QA report. |

### What "addressed" does and does not mean

Gaps 1, 2, 3 and 5 are implemented, typecheck clean, and — where the logic is
pure — unit tested. MFA in particular is verified against the published RFC
6238 vectors rather than against itself.

**Gap 4 is written but has not been executed.** The 13 E2E tests require
`TEST_DATABASE_URL`, and the development machine had no Docker, so they were
verified only to the point of registering and skipping cleanly. They run in CI
against the `postgres:17` service. **Until a CI run goes green, treat the E2E
suite as unproven.**

**Gap 5 is a harness, not a result.** The page makes the QA runnable; someone
still has to run it on the tablets the restaurants will actually use and attach
the report to the launch record. Plan §181 is explicit that this cannot be
satisfied from code alone.

---

## Complete and tested

### Foundation (Phase 1)

- Monorepo, strict TypeScript, ESLint, Prettier, Vitest, CI pipeline.
- `@jibli/config` — environment schema with production-specific refusals
  (a console OTP provider or a localhost CORS origin fails a production boot).
- `@jibli/logger` — pino with a redaction list covering tokens, OTPs, PINs,
  full phone numbers and precise addresses.
- Health endpoints: `/health/live` (process) and `/health/ready` (dependencies,
  plus live socket count for operational visibility).
- Graceful shutdown on SIGTERM/SIGINT for API and worker; sockets close before
  the HTTP server so clients receive a clean 1001.

### Money and finance arithmetic

- `@jibli/money` — integer IQD, flat per-order commission (ADR 0006), one half-up rounding
  policy, exact allocation. **42 tests**, including the plan's Appendix E worked
  example and a proof that a later rate change cannot alter a snapshot.
- Settlement periods — half-open `[start, end)` ranges in `Asia/Baghdad`.
  **26 tests** covering the day-15/16 boundary, 28/29/30/31-day months, the year
  boundary, and the case where UTC and Baghdad disagree about the date.
- Ledger derivation, settlement status derivation, payment guards,
  reconciliation invariants.

### Geography (Phase 2)

- All **19 governorates** and **115 canonical cities**, Arabic names, stable
  codes, source versioning.
- Effective-capability service with the parent-override rule. **28 tests**.
- Seed importer: inserts new units, updates descriptive fields, preserves IDs,
  never touches capability flags, refuses to reparent a city, reports orphans
  rather than deleting them.
- Public and admin geography APIs, coverage matrix, impact preview.
- CI gate (`verify-seed.ts`) proving the deployed database matches the dataset.

### Identity and MFA (Phase 2, plan §88)

- OTP request/verify with per-number cooldown, hourly and daily caps, IP caps,
  attempt limits, hashed codes, no account-existence leakage, and a staging
  allowlist that prevents texting real numbers.
- Sessions with refresh-token rotation and replay detection (a replayed token
  revokes the whole chain).
- Mandatory profile completion, re-validated server-side against current
  geography — including the mobile screen reloading its options on
  `CITY_NOT_AVAILABLE`.
- TOTP MFA: two-phase enrolment, 10 single-use recovery codes, counter-based
  replay blocking, per-user lockout after 5 failures in 15 minutes. **23 tests.**

### Ordering (Phase 4)

- Server-authoritative quoting with modifier ownership and min/max validation.
  **24 tests** covering price tampering, cross-restaurant items, fabricated
  modifier IDs and the minimum-order rule.
- PlaceOrder as a single transaction following the plan's documented sequence,
  with full snapshots, inventory reservation and an outbox event committed
  together.
- Idempotency: claim/replay/fail, with the unique index as the real guarantee.

### Restaurant operations (Phase 5)

- Live order board with lanes, SLA timers, optimistic concurrency, realtime
  updates and a polling fallback that visibly degrades rather than going quiet.
- Audible alert manager handling browser autoplay, deduplication, escalation,
  title badging and browser notifications — sound is never the only signal.
- Accept / reject / prepare / ready as named commands through the state machine.
- Transactional outbox publisher with `FOR UPDATE SKIP LOCKED`, exponential
  backoff with jitter, and a dead-letter state.

### Delivery (Phase 6)

- Driver model, restaurant membership, assignment with race resolution by
  partial unique index.
- Delivery PIN: hashed, salted per order, attempt-limited, never logged.
- COD completion as one atomic transaction — assignment, order, payment,
  inventory consumption, commission accrual, service-fee revenue and driver cash
  custody, all with idempotency keys.
- Google Maps and Waze link building with coordinate validation and fallbacks.

### Inventory (Phase 7)

- Fixed-precision stock arithmetic in integer milli-units. **31 tests**,
  including a proof that `0.1 + 0.2` accumulates exactly.
- Reservation at placement under row locks, release on rejection or
  cancellation, consumption at delivery — one shared implementation for all
  three, so they cannot drift apart.
- Low-stock evaluated on *available* stock and emitted through the outbox.

### Finance (Phase 8)

- Settlement generation with locking, eligibility by `completed_at`, totals
  validation before write, and DRAFT status for Finance review.
- Overdue evaluation that does **not** auto-suspend restaurants.
- Daily reconciliation that alerts and never rewrites history.

---

## Still outstanding before launch

These were never among the five, but they block a usable product:

1. **Portal and app screens.** The Admin Portal has 2 of ~15 pages, the
   Restaurant Portal 2 of 10, and the mobile app has no customer ordering flow
   at all. Navigation, API clients and types exist; the UIs do not.
   **This is now the largest gap.**
2. **Push provider.** Still the console stub. Notifications are recorded in
   `notification_deliveries` and dispatched, but nothing reaches a real device.
3. **File uploads.** Schema, visibility model and security requirements defined;
   no signed-URL issuer implemented.
4. **Restaurant self-onboarding wizard UI** — the API command exists.
5. **Coupons**: schema, funding-source arithmetic and validation complete; no
   redemption endpoint.
6. **Reviews and favourites**: schema and constraints only.
7. **Exports**: CSV formula-injection escaping exists; no export job.

---

## Test coverage

**241 unit tests passing** across 9 suites, plus **13 E2E tests** that run in CI:

| Suite | Tests | Covers |
| --- | --- | --- |
| `money/money` | 23 | Integer IQD, basis points, rounding, allocation |
| `money/order-total` | 19 | Commission, discount funding, delivery-fee ownership |
| `validation` | 40 | Arabic normalisation, Iraqi phone forms, CSV injection |
| `geography` | 28 | Parent override, capability assertions, dataset integrity |
| `domain/settlement-period` | 26 | Baghdad boundaries, month lengths, year rollover |
| `domain/working-hours` | 27 | Overnight shifts, split shifts, exceptions, busy mode |
| `domain/quote` | 24 | Pricing, tenant isolation, modifier rules, tampering |
| `domain/stock` | 31 | Fixed-precision arithmetic, races, recipes |
| `auth/mfa` | 23 | TOTP against RFC 6238 vectors, replay, recovery codes |

E2E (`pnpm test:e2e`, needs `TEST_DATABASE_URL`) asserts:

- commission snapshot correctness on a placed order
- a total that does not reconcile with its parts is rejected by the database
- a commission larger than its own base is rejected
- one active delivery assignment per driver, freed on completion
- commission cannot accrue twice for one order
- COD cash cannot be collected twice for one order
- a cash event whose sign contradicts its type is rejected
- one order cannot appear in two settlements
- a mismatched city/governorate pair is unrepresentable
- an outbox event rolls back with its failed transaction
- concurrent orders cannot oversell the last unit
- a retried reservation cannot double-hold stock
- disabling a city blocks ordering while destroying no data

Every package and app typechecks under `strict` with `noUncheckedIndexedAccess`.
