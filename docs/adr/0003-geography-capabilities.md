# ADR 0003 — Three geography capabilities, not one active flag

**Status:** Accepted · **Date:** 2026-09-11

## Context

Service coverage must be controlled centrally so a new city opens without a
mobile release (plan §4.2).

## Decision

Governorates and cities each carry `is_enabled` plus three independent
capabilities: `customer_signup_enabled`, `restaurant_onboarding_enabled`,
`ordering_enabled`. A city's effective capability is the AND of its own flag and
its parent's.

## Rationale

A single `is_active` flag cannot express the rollout that actually works:
recruit and approve restaurants in a city, create their drivers, complete menus,
run test orders — all before a customer can place one. With one flag the city is
either invisible or fully live, and there is nowhere to stand in between.

The parent override exists because the alternative is worse: a city row saying
`ordering_enabled = true` under a disabled governorate would look open in the
Admin UI while the server refused every order.

## Consequences

- The rule has exactly two implementations — `@jibli/geography` for in-memory
  rows and `effectiveCapabilitySql` for queries — and they are tested against
  the same cases.
- The Admin coverage matrix shows *effective* state, and a city enabled under a
  disabled parent renders as "معطّل بالمحافظة" rather than as enabled.
- Disabling never deletes. Existing orders finish, saved addresses remain
  stored but unorderable, and the Restaurant Portal stays accessible.
