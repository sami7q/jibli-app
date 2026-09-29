-- Cosmetics, as the third kind of merchant.
--
-- The same move migration 0016 made for markets, for the same reason: a
-- cosmetics shop is a partner with branches, a catalog priced per item,
-- orders against a branch, a courier, a commission and a portal. Nothing about
-- ordering differs, so nothing about the schema does either — the section gets
-- a value in the three `merchant_type` checks and its own aisles, and every
-- route that already filters by type serves it unchanged.
--
-- The constraints are dropped and re-added rather than altered because
-- Postgres has no ALTER for a CHECK. Both statements run in the migration's
-- transaction, so there is no moment in which an unknown value could slip in.

ALTER TABLE restaurants
  DROP CONSTRAINT IF EXISTS restaurants_merchant_type_check;

ALTER TABLE restaurants
  ADD CONSTRAINT restaurants_merchant_type_check
  CHECK (merchant_type IN ('RESTAURANT', 'MARKET', 'COSMETICS'));

COMMENT ON COLUMN restaurants.merchant_type IS
  'RESTAURANT (prepared food), MARKET (groceries) or COSMETICS (beauty and personal care). Decides which storefront the merchant appears in and the words the portal uses for its catalog.';

ALTER TABLE app_categories
  DROP CONSTRAINT IF EXISTS app_categories_merchant_type_check;

ALTER TABLE app_categories
  ADD CONSTRAINT app_categories_merchant_type_check
  CHECK (merchant_type IN ('RESTAURANT', 'MARKET', 'COSMETICS'));

ALTER TABLE app_banners
  DROP CONSTRAINT IF EXISTS app_banners_merchant_type_check;

ALTER TABLE app_banners
  ADD CONSTRAINT app_banners_merchant_type_check
  CHECK (merchant_type IN ('RESTAURANT', 'MARKET', 'COSMETICS'));

-- The cosmetics section's own aisles, carried in `cuisine_tags` exactly as a
-- market carries its aisles, so the category strip filters through the code
-- that is already there. `ON CONFLICT DO NOTHING` for the same reasons as
-- 0017: re-running is safe, and a name edited in Admin is not overwritten.
INSERT INTO app_categories (key, name_ar, emoji, sort_order, merchant_type) VALUES
  ('cs_makeup',    'مكياج',             '💄',  10, 'COSMETICS'),
  ('cs_skincare',  'العناية بالبشرة',   '🧴',  20, 'COSMETICS'),
  ('cs_haircare',  'العناية بالشعر',    '💇',  30, 'COSMETICS'),
  ('cs_perfume',   'عطور',              '🌸',  40, 'COSMETICS'),
  ('cs_nails',     'أظافر',             '💅',  50, 'COSMETICS'),
  ('cs_personal',  'عناية شخصية',       '🪥',  60, 'COSMETICS')
ON CONFLICT (key) DO NOTHING;
