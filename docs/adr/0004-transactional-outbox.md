# ADR 0004 — Transactional outbox for every domain event

**Status:** Accepted · **Date:** 2026-09-11

## Context

A restaurant that misses a new order loses the order and the customer. Realtime
delivery cannot be assumed.

## Decision

Every state change writes an `outbox_events` row in the same transaction. A
worker polls, publishes to Redis pub/sub and push, then marks the row published.

## Rationale

Calling a notification provider inside the transaction would hold a database
connection open across a network call to a third party — and a provider timeout
would roll back an order that the customer already paid for in intent.

Publishing after commit without an outbox row is worse: a crash between commit
and publish loses the event silently, and nothing in the system knows.

With the outbox, the worst case is a delayed alert. The order is committed and
the event is durable.

## Consequences

- Retries use exponential backoff with jitter; without jitter a provider outage
  produces a synchronised stampede the moment it recovers.
- After 12 attempts an event is parked as FAILED for a human rather than looping.
- The Restaurant Portal polls in addition to realtime, so a dropped frame is a
  latency problem, not a lost order.
- Consumers deduplicate on event ID, so a redelivery cannot double-alert.
