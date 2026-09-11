# Runbook — finance incident

Plan §162. Covers a reconciliation mismatch, a disputed settlement, or a
suspected duplicate charge.

## Reconciliation mismatch

The daily job logs `reconciliation.mismatch` and writes a FAIL row to
`reconciliation_runs`. Two invariants are checked:

```text
completed order commission snapshots = COMMISSION_ACCRUED ledger entries
completed COD orders                 = ORDER_CASH_COLLECTED driver cash events
```

**First: do not "fix" the data.** Automated reconciliation identifies a problem;
it never rewrites financial history, and neither should you. A manual UPDATE on
a ledger row destroys the evidence needed to understand what happened.

### Triage

1. Read the `details_json` on the failing `reconciliation_runs` row — it names
   the variance and the counts on each side.

2. **Count mismatch, amounts equal.** Usually an order completed near the day
   boundary. Confirm with:

   ```sql
   SELECT id, completed_at, commission_amount_iqd
   FROM orders
   WHERE status = 'COMPLETED'
     AND completed_at BETWEEN $day_start - interval '5 minutes'
                          AND $day_start + interval '5 minutes';
   ```

   If the order and its accrual fall on opposite sides of midnight Baghdad,
   the next day's run will balance. Record it and move on.

3. **Amount mismatch.** Find orders with no accrual:

   ```sql
   SELECT o.id, o.public_order_number, o.commission_amount_iqd
   FROM orders o
   LEFT JOIN ledger_entries l
     ON l.order_id = o.id AND l.entry_type = 'COMMISSION_ACCRUED'
   WHERE o.status = 'COMPLETED'
     AND o.completed_at >= $day_start AND o.completed_at < $day_end
     AND l.id IS NULL;
   ```

   An order completed without accruing commission means the COD completion
   transaction partially committed, which should be impossible — it is one
   transaction. Escalate to engineering with the order IDs; this is a bug, not
   a data-entry problem.

4. **Driver cash mismatch.** The same shape, against `driver_cash_events`.
   Remember: COD cash is *restaurant* cash in driver custody. It is never a
   Jibli commission payment, and the two balances must not be reconciled
   against each other.

### Resolution

Corrections are compensating entries, never edits:

- Commission too high → `COMMISSION_CREDIT`
- Commission too low → `COMMISSION_DEBIT`
- Whole entry wrong → `REVERSAL`, then a correct entry

Each requires `finance.adjustment.create`, which demands a fresh MFA challenge
and writes an audit row with your reason.

## Disputed settlement

A restaurant disputes through the portal with a reason. The statement moves to
DISPUTED and stops accruing overdue status.

1. Pull the settlement lines and compare against the restaurant's own record.
   Each line carries the commission base, the rate snapshot and the amount as
   they were at order completion.

2. If the restaurant's rate changed during the period, that is expected: orders
   snapshot the rate in force when they were placed, so one statement can
   legitimately contain lines at two different rates.

3. Resolve by credit, debit or reversal. Void and reissue only when the
   statement is structurally wrong — a void requires a reason and a fresh MFA
   challenge, and is visible to the restaurant.

## Suspected duplicate charge

Check for a duplicated order first:

```sql
SELECT key, scope, result_entity_id, created_at
FROM idempotency_keys
WHERE user_id = $user_id AND scope = 'place_order'
ORDER BY created_at DESC LIMIT 20;
```

Two orders from one intent would mean two different keys, which means the client
generated a new key on retry — a mobile bug, not a server one. The server cannot
produce two orders from one key: the unique index prevents it.
