# ADR 0002 — Integer IQD, never floating point

**Status:** Accepted · **Date:** 2026-09-11

## Context

Every order, commission, settlement and cash-custody balance is money. IQD is
used without fractional display in Release 1.

## Decision

All monetary values are JavaScript integers representing whole dinars, stored as
`bigint` columns. `packages/money` is the only place arithmetic happens, and
`iqd()` throws on a non-integer rather than rounding it.

## Rationale

`0.1 + 0.2 !== 0.3` is not a curiosity when it compounds across a half-month
settlement covering thousands of orders. The failure mode is a statement a
restaurant owner cannot reproduce on a calculator, which becomes a dispute.

Rejecting a float at construction is deliberate: a fractional IQD reaching that
function means a caller did untyped arithmetic somewhere, and failing loudly at
the boundary is cheaper than finding a one-dinar drift in a statement later.

`bigint` rather than `integer` because settlement and report aggregates exceed
int4 even though a single order never would.

## Consequences

- One rounding policy, half-up, applied only where a basis-point rate meets an
  amount. Half-up rather than banker's rounding because it is what a person
  reproduces by hand.
- `allocate()` distributes remainder dinars so a split always re-sums exactly.
- Inventory uses a separate fixed-precision representation (integer milli-units),
  because grams and litres genuinely need three decimal places.
