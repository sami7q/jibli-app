<div align="center">

# Jibli — Food Delivery Platform for Iraq

**Customer app with Driver Mode · Restaurant portal · Admin portal · API · Background worker**
One TypeScript monorepo, built for production rather than for a demo.

[![CI](https://github.com/sami7q/jibli-app/actions/workflows/ci.yml/badge.svg)](https://github.com/sami7q/jibli-app/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![React Native](https://img.shields.io/badge/React_Native-Expo-000020?logo=expo)
![Next.js](https://img.shields.io/badge/Next.js-portals-000000?logo=nextdotjs)
![Fastify](https://img.shields.io/badge/Fastify-API-202020?logo=fastify)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Drizzle-4169E1?logo=postgresql&logoColor=white)
![Tests](https://img.shields.io/badge/tests-718_cases-2EA44F)

**[Live restaurant portal →](https://jibli-partner.vercel.app)** &nbsp;·&nbsp; [Architecture](#architecture) &nbsp;·&nbsp; [Run locally](#run-locally) &nbsp;·&nbsp; [Tests](#tests) &nbsp;·&nbsp; [Design decisions](#design-decisions)

</div>

---

## What it is

Jibli is a food-delivery platform for the Iraqi market: customers order from restaurants, restaurant-owned drivers deliver, payment is cash on delivery and the platform takes a commission settled twice a month. The interface is Arabic-first (RTL).

| App                   | Stack               | Who uses it                                                      |
| --------------------- | ------------------- | ---------------------------------------------------------------- |
| `apps/mobile`         | Expo / React Native | Customers — and drivers, through **Driver Mode** in the same app |
| `apps/restaurant-web` | Next.js             | Restaurants: live orders, menu, stock, staff, drivers, earnings  |
| `apps/admin-web`      | Next.js             | Operations: cities, restaurants, commissions, settlements        |
| `apps/api`            | Fastify + WebSocket | REST API and realtime gateway                                    |
| `apps/worker`         | Node.js             | Transactional outbox, settlements, reconciliation                |
| `apps/legal`          | Next.js             | Privacy policy and terms pages                                   |

13 shared packages hold the actual business rules: `domain`, `money`, `contracts`, `db`, `auth`, `geography`, `validation`, `notifications`, `config`, `logger`, `design-tokens`, `ui-web`, `test-utils`.

## Screenshots

> UI design of the three client surfaces (Arabic, RTL).

| Customer app                                                                   | Restaurant portal                                                                          | Admin portal                                                                     |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| <img src="docs/design/02-mobile-app.png" width="230" alt="Jibli customer app"> | <img src="docs/design/03-restaurant-portal.png" width="380" alt="Jibli restaurant portal"> | <img src="docs/design/04-admin-portal.png" width="380" alt="Jibli admin portal"> |

## Architecture

```mermaid
flowchart LR
    subgraph Clients
        M["📱 Mobile app<br/>Expo / React Native<br/>customer + Driver Mode"]
        R["🍽️ Restaurant portal<br/>Next.js"]
        A["🛠️ Admin portal<br/>Next.js"]
    end

    subgraph Backend["Backend (Render, Docker)"]
        API["Fastify API<br/>REST + WebSocket gateway"]
        W["Worker<br/>outbox publisher · settlements · reconciliation"]
    end

    subgraph Core["Shared packages"]
        D["domain<br/>(hours, eligibility, quoting, stock, finance)"]
        MO["money<br/>(integer IQD, commission)"]
        C["contracts<br/>(state machines, permissions, events)"]
    end

    PG[("PostgreSQL<br/>Neon · Drizzle")]
    RD[("Redis<br/>pub/sub")]
    EXT["SMS OTP · Push notifications"]

    M & R & A -->|HTTPS / WSS| API
    API --> Core
    W --> Core
    API -->|"state change + outbox row<br/>in ONE transaction"| PG
    W -->|poll outbox| PG
    W -->|publish| RD --> API
    W --> EXT
```

**The layering rule:** business logic lives in `packages/domain` and `packages/money`, never in a route handler or a React component. Controllers authenticate, authorise, validate, call a use case and return a structured response.

### Order lifecycle

```mermaid
stateDiagram-v2
    [*] --> PLACED
    PLACED --> PENDING_RESTAURANT: system queues
    PENDING_RESTAURANT --> ACCEPTED: restaurant accepts
    PENDING_RESTAURANT --> REJECTED: restaurant rejects
    ACCEPTED --> PREPARING
    ACCEPTED --> READY
    PREPARING --> READY
    READY --> OUT_FOR_DELIVERY: driver picks up
    OUT_FOR_DELIVERY --> DELIVERED: driver confirms
    DELIVERED --> COMPLETED: COD closed
    PLACED --> CANCELLED: customer / admin
    PENDING_RESTAURANT --> CANCELLED: customer / admin
    ACCEPTED --> CANCELLED: restaurant / admin
```

Transitions — and which actor may perform each one — are declared once in `packages/contracts/src/state-machines.ts`. No endpoint accepts a free-form status string.

## Design decisions

The interesting part of this codebase is what it makes **impossible**. Most rules are enforced by the database, because application checks lose races.

| Must be impossible                         | Enforced by                                                          |
| ------------------------------------------ | -------------------------------------------------------------------- |
| A network retry creates a second order     | Unique index on `idempotency_keys (scope, key)`                      |
| An order is settled twice                  | Unique index on `settlement_lines (order_id)` across all settlements |
| Commission is recalculated at a later rate | Rate snapshotted onto the order; settlement reads the snapshot       |
| COD cash is credited twice                 | Partial unique index: one `ORDER_CASH_COLLECTED` per order           |
| Two drivers hold one delivery              | Partial unique index on active `delivery_assignments (driver_id)`    |
| Concurrent orders oversell stock           | Row lock + `SELECT … FOR UPDATE` on the inventory row                |
| An order total disagrees with its parts    | `CHECK` constraint on `orders`                                       |
| A stale client orders in a disabled city   | City capability re-checked inside the PlaceOrder transaction         |

Other decisions, each written up as an ADR in [`docs/adr`](docs/adr):

- **Modular monolith** over microservices — one deployable API, clear package boundaries ([ADR-0001](docs/adr/0001-modular-monolith.md)).
- **Integer money only** — IQD has no decimals here; `packages/money` refuses floats and uses one half-up rounding policy, so a restaurant owner can reproduce a statement on a calculator ([ADR-0002](docs/adr/0002-integer-money.md)).
- **Transactional outbox** — the state change and its event commit together; realtime being down delays an alert but never loses an order ([ADR-0004](docs/adr/0004-transactional-outbox.md)).
- **No live GPS in release 1** — presence heartbeat only; navigation hands off to Google Maps / Waze ([ADR-0005](docs/adr/0005-no-live-gps.md)).

## Tech stack

**Mobile:** Expo, React Native, TanStack Query, Sentry, Expo Notifications · **Web:** Next.js, React, TanStack Query, Zod · **API:** Fastify, `@fastify/websocket`, `@fastify/rate-limit`, Helmet, JOSE (JWT), Argon2 · **Data:** PostgreSQL (Neon), Drizzle ORM + SQL migrations, Redis · **Tooling:** pnpm workspaces, TypeScript strict, ESLint, Prettier, Vitest, GitHub Actions, Docker, esbuild bundles · **Hosting:** Render (API, worker), Vercel (portals)

## Run locally

Requirements: Node 20.19+, pnpm 9+, Docker.

```bash
git clone https://github.com/sami7q/jibli-app.git && cd jibli-app
pnpm install
cp .env.example .env              # fill in the secrets

pnpm infra:up                     # PostgreSQL, Redis, MinIO (Docker)
pnpm db:migrate                   # apply SQL migrations
pnpm db:seed                      # 19 governorates, 115 cities, config defaults

pnpm dev:api                      # http://localhost:4000
pnpm dev:worker
pnpm dev:restaurant               # http://localhost:3000
pnpm dev:admin                    # http://localhost:3001
pnpm dev:mobile                   # Expo
```

The development seed opens **Baghdad** so a fresh database is usable immediately. In local development the console OTP provider returns the code in the API response (`dev_code`), so you can sign in without an SMS gateway; it never does this in any other environment.

## Tests

```bash
pnpm test                 # unit tests (Vitest) — 718 test cases
pnpm test:coverage        # coverage, with enforced thresholds on money and geography
pnpm test:e2e             # end-to-end API flows
pnpm typecheck && pnpm lint
pnpm deploy:check         # typecheck + lint + test + build + bundle — what CI runs
```

## Repository layout

```text
apps/       api · worker · mobile · restaurant-web · admin-web · legal
packages/   domain · money · contracts · db · auth · geography · validation
            notifications · config · logger · design-tokens · ui-web · test-utils
docs/       adr · architecture · api · finance · security · operations · mobile
infra/      docker (local Postgres/Redis/MinIO, service Dockerfile)
```

## Status

Pre-launch. API and worker run on Render, portals on Vercel; the Android app is being prepared for Google Play release.

---

<div align="center">

Built by **Sami Aqeel** · [LinkedIn](https://www.linkedin.com/in/sami-sami-496a33231/) · [GitHub](https://github.com/sami7q) · sami22eng@gmail.com

</div>
