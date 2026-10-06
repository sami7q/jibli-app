# ADR 0006 — A flat commission per order, not a percentage

**Status:** Accepted · **Date:** 2026-09-13

## Context

The engineering plan specifies commission as a basis-point rate: a percentage of
the commission base, stored as `commission_rate_bps` on the restaurant's
effective-dated config and frozen onto each order as
`commission_rate_bps_snapshot`. The default was 1500 bps — 15%.

That is not how Jibli charges. Jibli charges a fixed amount for each order: 500
IQD, whether the order is 5,000 or 50,000.

## Decision

Commission is a flat amount in IQD per order, configured platform-wide in Admin
settings under the key `commission_flat_iqd` (Arabic label: **العمولة**), with a
per-restaurant override kept in the same effective-dated table as before.

- `restaurant_commission_configs.commission_rate_bps` → `commission_flat_iqd`
- `orders.commission_rate_bps_snapshot` → `commission_flat_iqd_snapshot`
- `settlement_lines.commission_rate_bps_snapshot` → `commission_flat_iqd_snapshot`
- `platform_config.default_commission_rate_bps` → `commission_flat_iqd`

`calculateOrderTotals` becomes `commissionAmountIqd = min(fee, commissionBase)`
where it was `applyBps(commissionBase, rate)`.

## Rationale

The percentage was a structural assumption, not a parameter: it lived in a
column typed for basis points, a check constraint bounding it to 0..10000, a
`bpsPercent()` formatter, and eleven screens that rendered `15%`. Leaving the
rate columns in place and writing `500` into them would have produced a system
whose schema, constraints and labels all said one thing while the business did
another — the kind of divergence that is discovered during a settlement dispute.

The **cap** is new and is not a business rule the operator asked for. A flat fee
larger than the order would drive `restaurant_net_snapshot_iqd` negative and
make a restaurant owe Jibli money for selling food. The minimum-order setting
should prevent it, but arithmetic that depends on a policy holding is arithmetic
with a hole in it, so the fee is capped at the commission base. The configured
fee is still recorded in the snapshot, so a capped order is visible as one
rather than looking like a restaurant on a different deal.

The per-restaurant table survives the change. It is what makes the snapshot rule
meaningful — every order freezes the fee in force when it was placed, so
changing the fee never rewrites a statement — and it is already wired through
settlement generation and both finance screens. What changed is that no screen
asks an operator to type a commission when creating or approving a restaurant:
the platform value applies, and an exception is a deliberate edit on the
restaurant's own page.

## Consequences

- Migration `0010_flat_commission.sql` backfills both snapshot columns from
  `commission_amount_iqd`, which is exact for any existing row: the fee that
  applied to a placed order _is_ the commission it was charged. It was applied
  when the tables held no orders, but it would have been correct if they had.
- Per-restaurant configs cannot be converted arithmetically — a percentage
  carries no amount — so every existing row moved to the platform default. A
  negotiated rate needs a renegotiated fee.
- `bpsPercent()` stays. Coupons are still percentages, and so is the restaurant
  share of a `SHARED`-funded discount.
- `commissionBaseIqd` keeps its meaning and its column. It is no longer what the
  commission is computed _from_, but it is still what the commission is capped
  at and what the restaurant earns on.
- Statement and commission tables lost their rate column: with a flat fee it
  repeated the commission column on every line except a capped one.
