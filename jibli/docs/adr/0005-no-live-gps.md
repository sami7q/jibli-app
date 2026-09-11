# ADR 0005 — No live driver GPS in Release 1

**Status:** Accepted · **Date:** 2026-09-11

## Context

Customers expect to watch a driver move on a map. The plan (§51) excludes it
from Release 1.

## Decision

No continuous location upload. Drivers send a lightweight presence heartbeat
while Driver Mode is open. Navigation happens in Google Maps or Waze.

## Rationale

Background location is the single most expensive feature on this list: it costs
battery, requires the hardest permission on both stores, carries a privacy and
retention burden, adds per-view map cost, and is the most OS-specific and
fragile thing a delivery app does.

The customer's real question is "where is my order?", and the status timeline
plus the driver's phone number answers it. A map dot is a nicer answer, not a
different one.

## Consequences

- `ACCESS_BACKGROUND_LOCATION` is deliberately absent from the Android manifest,
  and there is no `NSLocationAlwaysUsageDescription`. Requesting a permission
  "just in case" would fail store review and expand the privacy surface for a
  feature that does not exist.
- Presence is not location: the heartbeat endpoint accepts no coordinates.
- Adding live GPS later is a reviewed phase with its own retention policy and
  privacy controls — not a flag flip.
