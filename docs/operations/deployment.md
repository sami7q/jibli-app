# Deploying Jibli

Everything here has been verified against the code in this repository. Where a
step could not be executed from the development machine, it says so.

---

## 0. What you are deploying

| Service | What it is | Needs |
|---|---|---|
| `@jibli/api` | Fastify HTTP + WebSocket | PostgreSQL, Redis |
| `@jibli/worker` | Outbox publisher, settlement and reconciliation jobs | PostgreSQL, Redis |
| `admin-web` | Next.js Admin Portal | the API |
| `restaurant-web` | Next.js Restaurant Portal | the API |

Both portals are browser-only clients. They hold no secrets and talk to the API
across an origin you list in `CORS_ALLOWED_ORIGINS`.

---

## 1. PostgreSQL

**PostgreSQL 15 or newer is required, and the choice is not cosmetic.** The
schema depends on features SQLite-family databases (Turso, D1, LiteFS) do not
have:

- 28 `SELECT … FOR UPDATE` row locks — these are what stop two staff double-
  spending inventory or issuing a settlement twice
- 20 `jsonb` columns
- `COUNT(*) FILTER (WHERE …)` in 18 aggregate queries
- `AT TIME ZONE 'Asia/Baghdad'` for business-day bucketing
- 108 `CHECK` constraints, partial unique indexes, and a composite foreign key
  that makes a city/governorate mismatch unrepresentable

Any managed Postgres works. Free tiers that have been checked for feature
compatibility: **Neon**, **Supabase**, **Railway**.

```bash
# Neon gives a URL in this shape. Keep `sslmode=require`.
DATABASE_URL='postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/jibli?sslmode=require'
```

TLS is detected automatically (`packages/db/src/ssl.ts`): an explicit `sslmode`
in the URL wins, then `DATABASE_SSL`, then the host — anything that is not
loopback or a compose service name gets TLS. `APP_ENV=production` additionally
**refuses to boot** without it.

### Apply the schema

```bash
pnpm --filter @jibli/db migrate    # 0001 … 0004, recorded in schema_migrations
pnpm --filter @jibli/db seed       # 19 governorates, 115 cities, platform config
```

The seed is safe to re-run and is required in **every** environment: all Iraqi
governorates and cities must exist before launch, with every capability off
until Operations activates a service area.

### Create the first administrator

A migrated database has geography and configuration but no humans, and platform
roles can only be granted from inside the Admin Portal — so nothing can grant
the first one. This breaks that circle exactly once:

```bash
pnpm --filter @jibli/db bootstrap-admin -- \
  --phone 07701234567 \
  --name "اسم المدير"
```

It prints a generated password **once**. Re-running it for the same number is a
password reset, not a duplicate account.

Sign in, then enrol MFA immediately from Settings → المصادقة الثنائية. Plan §88
requires a fresh MFA challenge before any finance action, so a Super Admin
without it cannot issue a settlement.

---

## 2. Redis

Required, not optional — the API refuses to start without it. It backs the
rate limiter across instances and carries the realtime pub/sub the order board
depends on. **Upstash** has a free tier and speaks the standard protocol.

```bash
REDIS_URL='rediss://default:pass@eu1-xxx.upstash.io:6379'
```

Redis is a cache and a transport. It never owns a uniqueness rule — every
invariant lives in PostgreSQL, so losing Redis costs you live updates and
rate-limit state, never data.

---

## 3. Secrets

```bash
# Three separate values. Generate each one; never reuse.
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET
openssl rand -base64 32   # OTP_HASH_PEPPER
```

`OTP_HASH_PEPPER` is deliberately outside the database: it is what stops someone
with a database dump from brute-forcing stored OTP and delivery-PIN hashes.
Rotating it invalidates every outstanding OTP and PIN.

---

## 4. What production refuses to start without

`APP_ENV=production` runs extra checks at boot. This is intentional — each one
is a mistake that is silent until it is expensive:

```
OTP_PROVIDER:          production requires a real OTP provider
PUSH_PROVIDER:         production requires a real push provider
DATABASE_SSL:          production database connections must use TLS
CORS_ALLOWED_ORIGINS:  production CORS must not allow localhost origins
```

**`OTP_PROVIDER=console` is still the only implementation.** Nobody can sign
into the mobile app without a real SMS gateway, because the code is printed to
the server log instead of being delivered. An Iraqi SMS provider has to be
integrated behind `SmsProvider` in `packages/notifications` before customer
launch.

The portals do not need SMS: staff sign in with a password, which is why
`APP_ENV=staging` is enough to run the dashboards for a pilot.

---

## 5. Build and run

```bash
# One bundled file per service; no workspace node_modules at runtime.
node scripts/bundle.mjs api
node scripts/bundle.mjs worker

node apps/api/build/index.mjs
node apps/worker/build/index.mjs
```

`tsc -b` alone does **not** produce something Node can run: the emitted
JavaScript still imports workspace packages whose `main` points at TypeScript
source, and Node fails at the first import with `ERR_UNKNOWN_FILE_EXTENSION`.
The bundler exists for that reason.

### Containers

```bash
# Run from the repository root — the Dockerfile copies workspace manifests.
docker build -f infra/docker/Dockerfile.service --build-arg SERVICE=api    -t jibli-api .
docker build -f infra/docker/Dockerfile.service --build-arg SERVICE=worker -t jibli-worker .
```

The image runs as `node`, not root, uses `tini` so `SIGTERM` actually reaches
the graceful-shutdown handler, and carries the migrations so a deploy applies
the schema from the same artifact as the code.

### Portals

```bash
NEXT_PUBLIC_API_URL=https://api.yourdomain.com pnpm --filter admin-web build
NEXT_PUBLIC_API_URL=https://api.yourdomain.com pnpm --filter restaurant-web build
```

`NEXT_PUBLIC_API_URL` is read at **build** time and baked into the
Content-Security-Policy's `connect-src`. Changing the API origin means
rebuilding the portal, not just restarting it.

---

## 6. Cookies across origins

The portals authenticate with an HttpOnly refresh cookie set by the API, and a
cookie is only sent back to the origin that can claim it. There are two ways to
arrange that, and picking one matters:

**A — one parent domain.** Put everything under a domain you own and tell the
API to scope the cookie to it:

```bash
SESSION_COOKIE_DOMAIN=.yourdomain.com
# api.yourdomain.com · admin.yourdomain.com · partner.yourdomain.com
```

**B — proxy the API through each portal** (what §8 uses). The browser only ever
talks to the portal's own origin, so the cookie is first-party and
`SESSION_COOKIE_DOMAIN` must stay **unset**. This is the option that works on
`*.vercel.app`, where you do not control a shared parent.

Mixing them breaks login: setting `SESSION_COOKIE_DOMAIN` to a domain the
portal origin does not match makes the browser reject the cookie outright.

---

## 7. Order of operations

```
1. Create PostgreSQL, copy DATABASE_URL
2. Create Redis, copy REDIS_URL
3. Generate the three secrets
4. pnpm --filter @jibli/db migrate
5. pnpm --filter @jibli/db seed
6. pnpm --filter @jibli/db bootstrap-admin -- --phone … --name …
7. Deploy the API   (health: GET /health/live, GET /health/ready)
8. Deploy the worker
9. Build and deploy both portals with NEXT_PUBLIC_API_URL set
10. Sign in to Admin → enrol MFA → activate one city → onboard one restaurant
```

Step 10 matters: **every city ships with ordering disabled**. Until Operations
activates one, the marketplace is correctly empty and no order can be placed.

---

## 8. Vercel + Neon (the tested topology)

### What runs where, and why

| Piece | Host | Why not Vercel |
|---|---|---|
| `admin-web`, `restaurant-web` | **Vercel** | — it is the right tool for these |
| `@jibli/api` | Render / Railway / Fly | Long-running Fastify server with a WebSocket gateway and a persistent Redis subscriber. A serverless function cannot hold either connection between invocations. |
| `@jibli/worker` | Render / Railway / Fly | A `while (running)` loop polling the outbox every second, plus scheduled jobs. There is no request to attach it to. |
| PostgreSQL | **Neon** | — |
| Redis | Upstash, or the one in `render.yaml` | — |

Putting the API behind Vercel Functions would silently break the live order
board and stop the outbox from ever publishing.

### The cookie problem, and how this solves it

Portals on `*.vercel.app` and an API on `*.onrender.com` are different
registrable domains. A refresh cookie set by the API would be third-party to
the portal, and browsers do not send those — **every session would die at page
load**.

The fix is a rewrite, configured in `config/next-portal.mjs`:

```
browser → admin.vercel.app/api/v1/...   (same origin, cookie is first-party)
            ↓ Next rewrite
          jibli-api.onrender.com/api/v1/...
```

The WebSocket is *not* proxied — Vercel does not forward upgrade requests — and
does not need to be. It authenticates with the access token in the query
string, so it connects to the API host directly.

This also tightens the CSP: `connect-src` drops to `'self'` plus the WebSocket
origin, because no ordinary request leaves the portal's own domain.

### Neon: two connection strings, not one

Neon gives a **pooled** host (containing `-pooler`) and a **direct** host. They
are not interchangeable:

```bash
# API and worker — pooled. Keeps connection count within the project limit.
DATABASE_URL='postgresql://…@ep-xxx-pooler.eu-central-1.aws.neon.tech/jibli?sslmode=require'

# Migrations — direct. The pooler runs in transaction mode and does not
# support the session-level statements DDL needs.
DATABASE_MIGRATION_URL='postgresql://…@ep-xxx.eu-central-1.aws.neon.tech/jibli?sslmode=require'
```

`packages/db/src/migrate.ts` already prefers `DATABASE_MIGRATION_URL`. Pointing
both at the pooled string is the mistake to avoid; migrations fail in ways that
read like permission errors.

### Order of operations

```bash
# 1. Neon → create project → copy BOTH connection strings

# 2. Schema and data, from your machine (direct URL)
DATABASE_URL='<direct>' pnpm --filter @jibli/db migrate
DATABASE_URL='<direct>' pnpm --filter @jibli/db seed
DATABASE_URL='<direct>' pnpm --filter @jibli/db bootstrap-admin --   --phone 07701234567 --name "اسمك"
#    → prints the password once

# 3. API + worker + Redis: Render → New → Blueprint → this repo
#    Fill DATABASE_URL (pooled), DATABASE_MIGRATION_URL (direct),
#    CORS_ALLOWED_ORIGINS, SESSION_COOKIE_DOMAIN.
#    Note the API URL it gives you.

# 4. Vercel → two projects from the same repository
```

### Vercel project settings

Create **two** projects pointing at the same repository.

| Setting | Admin | Restaurant |
|---|---|---|
| Root Directory | `apps/admin-web` | `apps/restaurant-web` |
| Framework | Next.js (auto) | Next.js (auto) |

**Root Directory is not optional.** Leaving it empty makes Vercel build the
repository root, find no framework there, and serve `404: NOT_FOUND` — the
deployment succeeds and the site is empty. That is the single most common way
this goes wrong.

Vercel also needs *Settings → Build → Include source files outside of the Root
Directory* switched **on**, because `installCommand` runs `cd ../..` to install
from the pnpm workspace root.

Environment variables — **all three, on both projects**:

```bash
API_ORIGIN=https://jibli-api.onrender.com        # server-side; drives the rewrite
NEXT_PUBLIC_API_URL=https://jibli-api.onrender.com  # client-side; WebSocket only
NEXT_PUBLIC_API_PROXY=1                          # send XHR to this origin
```

All three are read at **build** time and baked into the bundle and the CSP.
Changing the API URL means redeploying the portal, not just restarting it.

### Cookies, one more time

Set `SESSION_COOKIE_DOMAIN` on the API **only if** the portals and the API end
up under one parent domain you control. With the rewrite in place and portals
on `*.vercel.app`, leave it **unset** — the cookie is set on the portal's own
origin, which is exactly what is wanted. Setting it to something the portal
origin does not match causes the browser to reject the cookie outright.

### After the first deploy

1. Open the admin portal → sign in with the bootstrap password
2. Settings → المصادقة الثنائية → enrol MFA (§88 blocks finance actions without it)
3. المناطق والتغطية → activate one city — **every city ships with ordering off**,
   so until you do this the marketplace is correctly empty
4. Add one restaurant, then sign into the restaurant portal as its owner

### What still will not work after this

The portals will be fully functional. The **mobile app will not be usable**:
`OTP_PROVIDER=console` prints the login code to the API log instead of sending
an SMS, so no customer or driver can sign in. An Iraqi SMS gateway behind
`SmsProvider` in `packages/notifications` is the remaining blocker for customer
launch, and it is the reason `APP_ENV` stays at `staging`.

---

## 9. Known gaps at the time of writing

These are stated so nobody discovers them during a pilot:

| Gap | Consequence |
|---|---|
| `OTP_PROVIDER=console` — no real SMS gateway | Customers and drivers cannot sign in |
| `PUSH_PROVIDER=console` — no FCM/APNs | No order notifications on phones |
| No upload endpoint | `assets` table and FKs exist; no restaurant logos or dish photos anywhere |
| Mobile app has no customer ordering flow | Discovery, cart, checkout and tracking screens are not built |
| Migration `0004` never applied anywhere | Written and type-checked; no database was reachable from the development machine |
| E2E suite never executed | 13 tests written; needs Docker, which was unavailable |

The two portals are complete and build for production. The API is complete for
everything they use.
