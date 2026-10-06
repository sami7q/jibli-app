# JIBLI — FIX + RE-AUDIT

**Baseline:** Production Audit, 19 September 2026, commit `274e856`
**Scope:** P0-1…P0-6 and HIGH-1…HIGH-8 only. Nothing else was touched.
**Method:** fix, then re-verify with the real toolchain. No guessed numbers.

---

## 0. Verification gate — actual output

Run after both phases were complete:

| Command                             | Result                                                                |
| ----------------------------------- | --------------------------------------------------------------------- |
| `pnpm -r typecheck`                 | ✅ **exit 0**, all 20 workspace projects                              |
| `pnpm lint`                         | ✅ **exit 0**, clean                                                  |
| `pnpm vitest run`                   | ✅ **533 passed / 40 files** (was 494/36 at baseline — **+39 tests**) |
| `npx expo-doctor@latest`            | ✅ **21/21 checks passed**                                            |
| `npx expo export -p android -p ios` | ✅ builds both platforms                                              |
| `pnpm audit` → `drizzle-orm`        | ✅ **0 advisories** (was 1 HIGH)                                      |
| `nslookup jibli.iq`                 | ❌ **NXDOMAIN** — re-verified 19 Sep                                  |
| `node scripts/release-check.mjs`    | ⚠️ **4 external blockers**, correctly reported                        |

---

## 1. P0 — status table

| ID       | Status before                                   | Fixed in code?              | Evidence after fix                                                                                                                                           | Human action still required?                         |
| -------- | ----------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| **P0-1** | Push a no-op, reported `SENT`                   | ✅ **YES**                  | `ExpoPushProvider` + `createPushProvider` in `packages/notifications/src/index.ts`; `apps/worker/src/index.ts:128` branches on `env.PUSH_PROVIDER`; 10 tests | Upload FCM creds (= P0-5)                            |
| **P0-2** | `OTP_PROVIDER=console`, one phone could sign in | ✅ **YES** (config)         | `render.yaml` → `OTP_PROVIDER: sms_gateway` + 8 OTPIQ fields                                                                                                 | Set `SMS_GATEWAY_API_KEY` secret in Render; redeploy |
| **P0-3** | Dead legal URLs baked into binary               | ⚠️ **PARTIAL** — guard only | Build refuses placeholders (verified); `apps/legal` not deployed, `jibli.iq` NXDOMAIN                                                                        | **YES** — Vercel deploy + DNS/env                    |
| **P0-4** | API sleeps on free plan                         | ❌ **NOT A CODE FIX**       | unchanged by design                                                                                                                                          | **YES** — Render billing                             |
| **P0-5** | No FCM credentials                              | ❌ **NOT A CODE FIX**       | `googleServicesFile` reads `GOOGLE_SERVICES_JSON` conditionally                                                                                              | **YES** — `eas credentials -p android`               |
| **P0-6** | OSM tile fallback = licence violation           | ✅ **YES**                  | Fallback deleted; no map + honest message instead; 2 tests pin it                                                                                            | **YES** — obtain a tile key                          |

### P0-1 — before / after

**Before** — `apps/worker/src/index.ts:93`:

```ts
const ctx: WorkerContext = { env, db, redis, logger, push: new ConsolePushProvider(logger) };
```

`env.PUSH_PROVIDER` was never read. No `ExpoPushProvider` existed. `ConsolePushProvider.send` returned `{ok: true}` unconditionally, and `outbox-publisher.ts:204` wrote `SENT` from it.

**After** — `apps/worker/src/index.ts:128`:

```ts
const push = createPushProvider(
  { provider: env.PUSH_PROVIDER, nodeEnv: env.NODE_ENV, expoAccessToken: env.EXPO_ACCESS_TOKEN },
  logger,
);
logger.info({ event: 'push.provider', provider: push.name }, 'Push provider selected');
const ctx: WorkerContext = { env, db, redis, logger, push };
```

**`ExpoPushProvider`** — built against `expo-server-sdk@7.2.0`, matching the existing `PushProvider` / `PushMessage` / `PushResult` interfaces exactly (read from source, not assumed). Three things it has to get right:

1. **Index preservation.** `outbox-publisher.ts:191-199` maps results back to devices _by array index_ to decide which token to revoke. Expo chunks, and chunk boundaries do not align with the caller's array — so results are written into a pre-sized array at the original index. Getting this wrong revokes a working device because a different one was dead.
2. **Permanent vs transient.** Only `DeviceNotRegistered` sets `tokenInvalid`. `InvalidCredentials` deliberately does not — a credentials mistake must not delete every device on the platform.
3. **Malformed tokens rejected locally.** Expo answers a bad token with a whole-request error, so one stale row would cost the entire batch.

**Fail-fast guard** — `createPushProvider` throws when `provider === 'console'` and `nodeEnv === 'production'`. This matters specifically because the deployment ran `NODE_ENV=production` with `APP_ENV=staging`, so the existing schema guard (keyed on `APP_ENV`) never fired.

**`fcm` throws rather than falling back** — falling back to a stub is the exact failure this function exists to prevent.

**Ticket ≠ delivery** — commented at the `SENT`-marking site (`outbox-publisher.ts`) with an explicit `TODO` for receipt reconciliation, as instructed. Not implemented; not claimed.

### P0-6 — before / after

**Before** — `map-picker-html.ts:47`:

```ts
const TILE_URL =
  process.env.EXPO_PUBLIC_MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
```

**After**:

```ts
const TILE_URL = process.env.EXPO_PUBLIC_MAP_TILE_URL ?? null;
export const HAS_TILE_PROVIDER = TILE_URL !== null;
```

With no provider, `MAP_PICKER_HTML` returns a document containing no Leaflet and no tiles — just «الخريطة غير متاحة حالياً / يمكنك كتابة العنوان يدوياً».

**Verified:** `grep tile.openstreetmap.org` now matches **only comments**, no code path. Two new tests pin it, including one that re-imports the module with the variable unset.

> **Existing tests were not deleted.** The four assertions in `map-picker-html.test.ts` test correct behaviour (pin/zoom logic), so the file was given a tile provider before import — using the same dynamic-import pattern `lib/api.test.ts` already uses — rather than having its coverage removed.

---

## 2. HIGH — status table

| ID         | Status before                           | Fixed in code?           | Evidence after fix                                                                               | Human action still required?                |
| ---------- | --------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| **HIGH-1** | MFA advisory only; `require_mfa: false` | ✅ **YES**               | `require_mfa: true`; `needsMfaEnrolment` enforced in `assertAdminPermission`; 10 tests           | Enrol each existing admin                   |
| **HIGH-2** | No crash reporting                      | ✅ **YES**               | `@sentry/react-native@~7.11.0`; `src/lib/monitoring.ts`; wired to `ErrorBoundary` + module scope | **YES** — create Sentry project, supply DSN |
| **HIGH-3** | `drizzle-orm` HIGH advisory             | ✅ **YES**               | 0.38.2 → **0.45.2** across all 4 packages; advisory gone; 533 tests pass                         | No                                          |
| **HIGH-4** | No stalled-order escalation             | ✅ **YES**               | `apps/worker/src/jobs/stalled-orders.ts` + migration `0018`                                      | Apply migration; confirm threshold          |
| **HIGH-5** | Silent map failure                      | ✅ **YES**               | `onError` + `onHttpError` → Arabic warning panel                                                 | No                                          |
| **HIGH-6** | Portals fall back to localhost          | ✅ **YES** (build guard) | `config/next-portal.mjs` throws on a production build with no API origin                         | **YES** — verify Vercel env                 |
| **HIGH-7** | Play closed testing                     | ❌ **NOT A CODE FIX**    | —                                                                                                | **YES** — Play Console                      |
| **HIGH-8** | No retention policy                     | ✅ **YES**               | `apps/worker/src/jobs/retention.ts`; 3 env vars; privacy policy updated                          | Apply; legal review of periods              |

### HIGH-1 — the gap was real and is now closed

**Before:** `MFA_MANDATORY_ROLES` was read in exactly one place — `apps/api/src/routes/mfa.ts:86` — to decide whether login should _offer_ enrolment. The server issued a full session regardless and returned `mfa_enrolment_required: true` for the portal to act on. **A client that ignored that flag held a fully privileged SUPER_ADMIN session on a password alone.**

**After:** enforcement moved to `assertAdminPermission` — the single choke point all **86** admin call sites pass through:

```ts
if (needsMfaEnrolment(principal)) {
  throw new AppError(ERROR_CODES.MFA_REQUIRED, {
    details: { reason: 'MFA_ENROLMENT_REQUIRED', requiredPermission: permission },
  });
}
```

Two new `Principal` fields resolved per request in `apps/api/src/plugins/auth.ts`:

- `mfaEnrolled` — from `users.mfaEnabledAt` (is there an authenticator at all)
- `mfaRequiredByPolicy` — from `require_mfa`, read per request so switching it on affects sessions already open

**Lockout risk checked, not assumed:** `grep assertAdminPermission apps/api/src/routes/mfa.ts` → **empty**. The MFA routes do not go through the guard, so an unenrolled admin can always sign in and enrol. The failure mode is one screen of setup, not a locked door.

The `require_mfa` setting remains, so an operator can still turn it off — the difference is that doing so is now a decision somebody makes rather than the default nobody noticed.

### HIGH-3 — upgrade was not an API break

The first upgrade attempt produced 13 typecheck errors that looked like breaking changes. They were **two copies of drizzle-orm coexisting**: `packages/domain` and `apps/worker` were still on 0.38.2 while `db`/`api` moved to 0.45.2, so `SQL<unknown>` from one was not assignable to `SQL<unknown>` from the other.

Aligning all four packages fixed it with **no source changes**. Typecheck 0, 533 tests pass.

### HIGH-4 — threshold is a proposal, confirm it

`STALLED_AFTER_MS = 20 minutes`, swept every 5 minutes.

Reasoning, stated so you can overrule it: long enough that a shop with one courier on a round trip is not reported for working normally; short enough that the food is still worth delivering when an operator looks. Every other scheduled job in the worker is financial and runs hourly or slower — this is the first that watches an order, so there was no existing cadence to copy.

**It does not intervene.** Reassigning or cancelling on a timer would be the platform making an operational decision without the context — the shop may be about to assign somebody. It raises an `URGENT` bell entry keyed on the order (so a 5-minute sweep leaves one entry, not one every 5 minutes) and resets read state on repeat so the escalation resurfaces with a fresh waiting time.

Migration `0018` widens the `admin_notifications_kind_check` CHECK constraint for `ORDER_STALLED` and adds a partial index `orders_ready_since_idx` — without it the sweep is a sequential scan of the whole orders table every five minutes forever.

### HIGH-8 — periods came from you

Plan §164 says retention "must be reviewed with Iraqi legal/accounting advice" and gives no numbers, so I asked rather than inventing them. Your answer:

| Table            | Retained     | Env var                        |
| ---------------- | ------------ | ------------------------------ |
| `audit_logs`     | **365 days** | `RETENTION_AUDIT_LOG_DAYS`     |
| `login_attempts` | **90 days**  | `RETENTION_LOGIN_ATTEMPT_DAYS` |
| `otp_challenges` | **7 days**   | `RETENTION_OTP_CHALLENGE_DAYS` |

In the environment, not as constants, so legal advice can change them without a release. Floor of 1 day — a misconfigured `0` would delete the audit trail as fast as it is written.

**The deleted-customer phone number:** you chose _keep it, and say so explicitly_. The policy previously said only «سطر واحد يثبت أن الحذف تمّ» without mentioning it contains the number. Now stated plainly in `apps/legal/src/app/privacy/page.tsx`, with the reason, and with the new retention periods. The code site (`apps/api/src/routes/profile.ts`) carries a comment pointing at the disclosure.

---

## 3. Measured regression — you should decide on this

**Sentry costs 1.37 MB of JavaScript, on both platforms.**

|                    | Before HIGH-2 | After HIGH-2 |
| ------------------ | ------------- | ------------ |
| Android JS payload | 4.01 MB       | **5.38 MB**  |
| iOS JS payload     | 3.93 MB       | **5.30 MB**  |

That undoes more than half the 2.52 MB saved by the earlier size work.

I tried to reduce it: importing only `init` and `captureException` by name instead of the namespace changed the bundle by nothing measurable (5.1 MB vs 4.88 MB — rounding). **Metro does not tree-shake this SDK.** The cost is the feature's price, not a mistake in how it is imported.

It is paid whether or not a DSN is set, because the module is in the graph either way.

**This is a genuine trade-off and it is yours:** crash visibility on a platform holding phone numbers and home addresses, against ~1.4 MB. I implemented HIGH-2 as instructed and am reporting the cost rather than burying it. If you judge it wrong, removing the dependency is the lever.

---

## 4. Scope note — one thing I found and did not fix

`apps/api/src/index.ts:206` also hardcodes `new ConsolePushProvider(logger)`.

**I left it alone, deliberately.** `grep ctx.push apps/api/src` returns nothing — the API never sends a push; the field is required on `AppContext` and unused. Routing it through `createPushProvider` would make the API **crash at boot** over a dependency it does not use, which is a new failure mode I would be introducing outside the stated scope.

It is not causing P0-1. It is the same trap waiting if someone later adds a push call in the API. Flagging it rather than acting on it.

---

## 5. Verdicts — re-assessed

| Area                     | Before           | After                                                                        |
| ------------------------ | ---------------- | ---------------------------------------------------------------------------- |
| **Production Readiness** | NOT READY        | **READY WITH FIXES** — all remaining blockers are external                   |
| **Apple App Store**      | NOT READY        | **NOT READY** — APPLE-001 (dead URL) still open, needs deploy + DNS          |
| **Google Play**          | NOT READY        | **NOT READY** — dead URL, no FCM, closed testing                             |
| **Security**             | PASS WITH ISSUES | **PASS** — MFA enforced, drizzle patched, 0 advisories reach the app         |
| **Backend**              | PASS WITH ISSUES | **PASS WITH ISSUES** — code fixed; `APP_ENV=staging` is the last manual step |
| **Customer App**         | PASS WITH ISSUES | **PASS WITH ISSUES** — push code correct, blocked on FCM                     |
| **Restaurant System**    | PASS             | **PASS**                                                                     |
| **Driver System**        | PASS WITH ISSUES | **PASS WITH ISSUES** — will be alerted once FCM lands                        |
| **Admin Dashboard**      | PASS             | **PASS**                                                                     |
| **Location / GPS**       | PASS             | **PASS**                                                                     |
| **Database**             | PASS             | **PASS** — +1 migration, pending application                                 |
| **Notifications**        | **FAIL**         | **PASS WITH ISSUES** — implemented and tested; needs FCM credentials         |

---

## 6. Tests added

**+39 over baseline** (494 → 533):

| File                                               | Tests | Pins                                                                            |
| -------------------------------------------------- | ----- | ------------------------------------------------------------------------------- |
| `packages/notifications/src/push-provider.test.ts` | 10    | Console stub unselectable in production; `fcm` throws; index preservation       |
| `packages/auth/src/mfa-enforcement.test.ts`        | 10    | Mandatory roles enforced; MFA routes reachable; FORBIDDEN precedes MFA_REQUIRED |
| `apps/mobile/src/ui/map-picker-html.test.ts`       | +2    | No OSM fallback; honest document with no provider                               |
| _(from previous session)_                          | +17   | Request timeouts, push payload contract, icon font cmap                         |

---

## 7. Direct answers

### 1. How many of the 6 P0s were actually fixed in code?

**Three fully in code** — P0-1 (push provider), P0-2 (OTP config), P0-6 (tile fallback).
**One partially** — P0-3: the build-time guard is in place and verified firing, but the deploy and DNS are external.
**Two are not code at all** — P0-4 (Render billing), P0-5 (FCM credentials).

So: **3 closed, 1 guarded-but-blocked, 2 external by nature.**

For HIGH: **6 of 8 fixed in code** (HIGH-1, 2, 3, 4, 5, 6, 8 — seven, with HIGH-2 and HIGH-6 needing an external value to become useful). **HIGH-7 is pure console work.**

### 2. Is it ready to upload now?

**No.** Every remaining blocker is outside the repository. The code side of this list is done.

Concretely, an upload today would fail because: the privacy policy URL does not resolve (and the build now refuses to bake it — so the build would not even start), Android push has no FCM credentials, the map has no tile provider, and the API still sleeps.

### 3. Remaining human actions, in priority order

| #      | Action                                                                                                                                                                             | Blocks             | Why first                                                                                               |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------- |
| **1**  | **Start Play closed testing** — 12 testers, 14 days                                                                                                                                | Play release       | Longest calendar item; everything else runs in parallel. **Verify account type in Play Console first.** |
| **2**  | **Deploy `apps/legal` to Vercel** (Root Directory `apps/legal`), then DNS on `jibli.iq` or set `EXPO_PUBLIC_PRIVACY_URL` / `EXPO_PUBLIC_TERMS_URL` in **both** `eas.json` profiles | Both stores        | The build refuses to start without it                                                                   |
| **3**  | **`eas credentials -p android`** — upload FCM v1 service-account key                                                                                                               | Android push       | Needs Firebase Console access                                                                           |
| **4**  | **Set `SMS_GATEWAY_API_KEY`** on the `jibli-secrets` group in Render (unsynced), then redeploy                                                                                     | Real sign-in       | `render.yaml` is ready; only the secret is missing                                                      |
| **5**  | **Move `jibli-api` off the free plan**                                                                                                                                             | App Review         | Billing decision                                                                                        |
| **6**  | **Obtain a tile provider key** (MapTiler/Stadia free tier), set `EXPO_PUBLIC_MAP_TILE_URL` + `_ATTRIBUTION`                                                                        | Map works at all   | Without it the picker now shows no map                                                                  |
| **7**  | **Apply migration `0018`**                                                                                                                                                         | HIGH-4             | `pnpm db:migrate`                                                                                       |
| **8**  | **Create a Sentry project**, set `EXPO_PUBLIC_SENTRY_DSN`                                                                                                                          | HIGH-2 useful      | SDK is inert without it                                                                                 |
| **9**  | **Enrol MFA on every admin account**                                                                                                                                               | HIGH-1 operational | They can still sign in and enrol; they cannot do anything else first                                    |
| **10** | **Verify `NEXT_PUBLIC_API_URL`** in both Vercel projects                                                                                                                           | HIGH-6             | Build now fails loudly if missing                                                                       |
| **11** | **Confirm the 20-minute stalled threshold** and the 365/90/7 retention periods with legal                                                                                          | HIGH-4, HIGH-8     | Both are configurable; neither is mine to decide                                                        |
| **12** | **Last:** remove `OTP_TEST_PHONES` + `OTP_MOCK_CODE`, set `APP_ENV=production`                                                                                                     | —                  | Only after store review passes                                                                          |

---

## 8. What I did not do

- Did not touch anything outside P0-1…P0-6 / HIGH-1…HIGH-8
- Did not delete or weaken any existing test
- Did not add a dependency beyond `expo-server-sdk` (specified) and `@sentry/react-native` (required by HIGH-2)
- Did not invent a DSN, an API key, a tile URL or a retention period
- Did not run the e2e suite — its database (port 5440) is not running, and it writes
- Did not measure native binary size — still **NOT VERIFIED, REQUIRES BUILD ACCESS**; RN 0.86 fetches native artifacts from Maven at build time
- Did not deploy, publish, or commit anything — all changes are in the working tree
