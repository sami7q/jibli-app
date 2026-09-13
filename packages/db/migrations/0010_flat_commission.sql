-- Commission becomes a flat fee per order.
--
-- Jibli charged a percentage of every order: 15% by default, stored as basis
-- points on the restaurant's commission config and frozen onto each order. The
-- business does not work that way. Jibli charges 500 IQD per order — the same
-- amount whether the order is 5,000 or 50,000, because the work the platform
-- does for the restaurant is the same either way — and that amount is one
-- number in Admin settings.
--
-- Three places carried the rate, and all three become an amount:
--
--   restaurant_commission_configs  what this restaurant is charged, effective-dated
--   orders                         the fee frozen at placement
--   settlement_lines               the same fee, copied onto the statement
--
-- The backfill for the two snapshot columns is `commission_amount_iqd`: for an
-- order that already exists, the fee that applied to it *is* the commission it
-- was charged. That is exact regardless of what the old percentage was, so this
-- migration is correct whether the table holds no rows or a year of them.
--
-- The config table has no such exact answer — a percentage cannot be converted
-- into a fee without knowing the orders it would have applied to — so every
-- restaurant moves to the new platform default. Any restaurant on a negotiated
-- rate needs a new negotiated fee, which is a conversation, not a division.

-- The runner applies each file inside its own transaction, so there is no
-- BEGIN here: an explicit one would nest and commit early.

-- ── Orders ──────────────────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_flat_iqd_snapshot bigint;

UPDATE orders
   SET commission_flat_iqd_snapshot = commission_amount_iqd
 WHERE commission_flat_iqd_snapshot IS NULL;

ALTER TABLE orders ALTER COLUMN commission_flat_iqd_snapshot SET NOT NULL;

-- The old range check covered basis points; the new column is money.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_commission_bps_range;
ALTER TABLE orders DROP COLUMN IF EXISTS commission_rate_bps_snapshot;

ALTER TABLE orders
  ADD CONSTRAINT orders_commission_flat_non_negative
  CHECK (commission_flat_iqd_snapshot >= 0);

COMMENT ON COLUMN orders.commission_flat_iqd_snapshot IS
  'Jibli''s flat fee frozen at placement. commission_amount_iqd is this, capped at commission_base_iqd.';

-- ── Settlement lines ────────────────────────────────────────────────────────
ALTER TABLE settlement_lines ADD COLUMN IF NOT EXISTS commission_flat_iqd_snapshot bigint;

UPDATE settlement_lines
   SET commission_flat_iqd_snapshot = commission_amount_iqd
 WHERE commission_flat_iqd_snapshot IS NULL;

ALTER TABLE settlement_lines ALTER COLUMN commission_flat_iqd_snapshot SET NOT NULL;

ALTER TABLE settlement_lines DROP CONSTRAINT IF EXISTS settlement_lines_bps_range;
ALTER TABLE settlement_lines DROP COLUMN IF EXISTS commission_rate_bps_snapshot;

ALTER TABLE settlement_lines
  ADD CONSTRAINT settlement_lines_commission_flat_non_negative
  CHECK (commission_flat_iqd_snapshot >= 0);

-- ── Per-restaurant configuration ────────────────────────────────────────────
ALTER TABLE restaurant_commission_configs
  ADD COLUMN IF NOT EXISTS commission_flat_iqd bigint;

UPDATE restaurant_commission_configs
   SET commission_flat_iqd = 500
 WHERE commission_flat_iqd IS NULL;

ALTER TABLE restaurant_commission_configs
  ALTER COLUMN commission_flat_iqd SET NOT NULL;

ALTER TABLE restaurant_commission_configs DROP CONSTRAINT IF EXISTS commission_bps_range;
ALTER TABLE restaurant_commission_configs DROP COLUMN IF EXISTS commission_rate_bps;

ALTER TABLE restaurant_commission_configs
  ADD CONSTRAINT commission_flat_non_negative
  CHECK (commission_flat_iqd >= 0);

COMMENT ON COLUMN restaurant_commission_configs.commission_flat_iqd IS
  'Flat fee per order in IQD for this restaurant. Seeded from the platform commission_flat_iqd setting.';

-- ── The platform-wide amount ────────────────────────────────────────────────
-- One number, named "العمولة" in Admin settings.
INSERT INTO platform_config (id, key, value, description_ar, is_sensitive, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'commission_flat_iqd',
  '500'::jsonb,
  'العمولة التي يتقاضاها جيبلي عن كل طلب (دينار عراقي)',
  true,
  now(),
  now()
)
ON CONFLICT (key) DO NOTHING;

-- The percentage is gone from the code, so leaving its row would show Admin a
-- setting that changes nothing. Its history rows stay — that is the record of
-- what the value used to be.
DELETE FROM platform_config WHERE key = 'default_commission_rate_bps';
