# Jibli — منصة توصيل الطعام العراقية

Production platform for Iraqi food delivery: a React Native customer app with
Driver Mode, a Next.js Restaurant Portal, a Next.js Admin Portal, a Fastify API
and a background worker.

Built to `jibli_complete_engineering_plan_en.md`. Section references in the code
(`plan §27`) point back to that document — they are how a reader checks that an
implementation still matches the decision behind it.

---

## Release 1 at a glance

| Decision | Choice |
| --- | --- |
| UI language | Arabic only, RTL as the native direction |
| Market | Iraq — all 19 governorates seeded, coverage activated per city |
| Payment | Cash on delivery |
| Delivery | Restaurant-owned drivers, created by restaurants |
| Navigation | Google Maps default, Waze alternative, no in-app turn-by-turn |
| Driver tracking | None. Presence heartbeat only — no live GPS |
| Money | Integer IQD everywhere. No floating point, ever |
| Commission | Basis points, snapshotted per order |
| Settlement | Half-month or calendar month, `Asia/Baghdad` |

---

## Repository layout

```text
jibli/
  apps/
    api/              Fastify HTTP API
    worker/           Outbox publisher, settlements, reconciliation
    restaurant-web/   Next.js Restaurant Portal  (:3000)
    admin-web/        Next.js Admin Portal       (:3001)
    mobile/           Expo / React Native — customer + Driver Mode
  packages/
    config/           Environment schema and startup validation
    logger/           Structured logging with mandatory redaction
    money/            Integer IQD arithmetic and the commission formula
    validation/       Arabic normalisation, Iraqi phone numbers, shared schemas
    contracts/        Error taxonomy, enums, state machines, permissions, events
    geography/        Iraq master dataset and effective-capability rules
    db/               Drizzle schema, SQL migrations, seed
    auth/             Tokens, hashing, RBAC guards
    domain/           Business rules: hours, eligibility, quoting, stock, finance
    notifications/    SMS and push provider abstractions
    ui-web/           Design tokens, Arabic labels and formatting
  docs/               Architecture, ADRs, finance, security, operations
  infra/docker/       Local PostgreSQL, Redis and MinIO
```

The layering rule: **business logic lives in `packages/domain` and
`packages/money`, never in a route handler or a React component.** API
controllers authenticate, authorise, validate, invoke a use case and return a
structured response (plan §6).

---

## Getting started

Requires Node 20.9+, pnpm 9+, and Docker for local infrastructure.

```bash
pnpm install
cp .env.example .env          # then fill in the secrets

pnpm infra:up                 # PostgreSQL, Redis, MinIO
pnpm db:migrate               # apply SQL migrations
pnpm db:seed                  # 19 governorates + 115 cities + config defaults

pnpm dev:api                  # http://localhost:4000
pnpm dev:worker
pnpm dev:restaurant           # http://localhost:3000
pnpm dev:admin                # http://localhost:3001
pnpm dev:mobile               # Expo
```

The development seed opens **Baghdad** for signup, onboarding and ordering so a
fresh database is immediately usable. A production seed leaves every capability
off — Operations activates launch cities from the Admin Portal (plan §9).

In local development the console OTP provider returns the code in the API
response (`dev_code`) so you can sign in without an SMS gateway. It never does
this in any other environment.

---

## Commands

```bash
pnpm test                # unit tests
pnpm test:coverage       # with thresholds on money and geography
pnpm typecheck           # all packages and apps
pnpm lint
pnpm db:migrate
pnpm db:seed
```

---

## The invariants this codebase exists to protect

The plan defines production-readiness as a set of things that must be
impossible. Each one is enforced in a specific place — usually a database
constraint, because application checks lose races.

| Invariant | Where it is enforced |
| --- | --- |
| A stale client cannot order in a disabled city | `assertCityCapability` re-checked inside the PlaceOrder transaction |
| A city can never belong to the wrong governorate | Composite FK `(city_id, governorate_id)` → `cities(id, governorate_id)` |
| A network retry cannot create a second order | Unique index on `idempotency_keys (scope, key)` |
| Commission cannot be recalculated at a later rate | Rate snapshotted onto the order; settlement reads the snapshot |
| An order cannot be settled twice | Unique index on `settlement_lines (order_id)` — across all settlements |
| A settlement cannot be issued twice for a period | Unique index on `settlements (restaurant_id, period_start, period_end)` |
| Commission cannot double-accrue | Unique index on `ledger_entries (idempotency_key)` |
| COD cash cannot be double-credited | Partial unique index: one `ORDER_CASH_COLLECTED` per order |
| Two drivers cannot hold one delivery | Partial unique index on active `delivery_assignments (driver_id)` |
| A reassigned driver cannot complete the delivery | `assertOwnsAssignment` against the live assignment row |
| Concurrent orders cannot oversell stock | Row lock plus `SELECT … FOR UPDATE` on the inventory row |
| An order total cannot disagree with its parts | `CHECK` constraint on `orders` |
| A completed order must be delivered and paid | `CHECK` constraint on `orders` |
| Disabling a city destroys nothing | Capability flags only; no cascade, no delete |

---

## Architecture notes

**Server-side authority.** Prices, availability, geography, eligibility,
commissions and totals are decided by the backend. Clients are untrusted
presentation layers. The quote endpoint and PlaceOrder run the *same* pricing
code so the displayed total and the charged total cannot drift apart.

**Transactional outbox.** A state change and its event row commit together, so
"the order exists but nobody was told" cannot happen. The worker publishes to
realtime and push afterwards; realtime being down delays an alert but never
loses an order. The Restaurant Portal also polls, so a dropped websocket frame
is not a missed order.

**Controlled state machines.** Order, delivery and settlement transitions are
declared once in `packages/contracts/src/state-machines.ts`, together with which
actor may perform each one. There is no endpoint that accepts a status string.

**Money.** IQD is a zero-decimal currency here; all amounts are integers.
`packages/money` is the only place arithmetic happens, it refuses a float
outright, and it uses one half-up rounding policy so a restaurant owner can
reproduce a statement on a calculator.

**Geography.** Three independent capabilities — customer signup, restaurant
onboarding, ordering — because the rollout sequence needs them separate: recruit
restaurants in a city before opening it for orders. A child is never stronger
than its parent, and that rule has exactly one implementation for in-memory rows
(`@jibli/geography`) and one for SQL (`effectiveCapabilitySql`).

---

## Documentation

- [`docs/architecture/`](docs/architecture) — system overview and data model
- [`docs/adr/`](docs/adr) — architecture decision records
- [`docs/finance/`](docs/finance) — commission, settlement and reconciliation
- [`docs/security/`](docs/security) — threat model and controls
- [`docs/operations/`](docs/operations) — runbooks and the geography rollout

---

## Status

Implemented and tested: platform foundation, geography and identity, catalog,
ordering, live restaurant operations, driver mode and COD delivery, inventory
arithmetic, finance and settlement generation, admin operations.

See [`docs/operations/implementation-status.md`](docs/operations/implementation-status.md)
for what is complete, what is scaffolded, and what remains before a pilot.
