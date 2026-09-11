# ADR 0001 — Modular monolith, not microservices

**Status:** Accepted · **Date:** 2026-09-11

## Context

Jibli has four client surfaces and several domains that interact constantly:
geography gates ordering, ordering produces commission, commission produces
settlements, delivery produces cash custody.

## Decision

One deployable API plus one worker, with modules separated by package boundary
rather than by network boundary. Extraction stays possible because domain logic
already lives in `packages/domain` behind explicit interfaces.

## Rationale

An order is one transaction touching orders, order items, inventory
reservations, status history and the outbox. As a monolith that is a single
`BEGIN … COMMIT`. Split across services it becomes a distributed transaction, and
the platform would need sagas and compensations before it has a single customer.

The plan (§5.3) reaches the same conclusion: "not an early microservice
explosion."

## Consequences

- Financial and inventory invariants are enforced by database constraints inside
  one transaction, which is the strongest guarantee available.
- The worker is already a separate process, so a slow settlement run cannot
  delay an order — the split that actually mattered was made.
- Scaling is horizontal replicas behind a load balancer. Correctness under
  multiple replicas is handled by unique indexes and `FOR UPDATE SKIP LOCKED`,
  not by there being only one instance.
