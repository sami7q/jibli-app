-- Each storefront gets its own front page.
--
-- Migration 0016 split the merchants; this splits what is merchandised around
-- them. A category strip offering «برجر» and «مشاوي» above a list of groceries
-- is not a smaller problem than showing the wrong shops — it is the same
-- problem one layer up, and a customer who taps «كباب» in the market half and
-- gets an empty list learns that the filters lie.
--
-- Banners are the sharper case. They are the one paid placement in the app,
-- sold per season and per partner, and a Ramadan offer from a restaurant has
-- no business rotating above a grocery basket. Selling a placement means
-- promising where it appears.
--
-- Defaulted to RESTAURANT, so every row that exists today keeps appearing
-- exactly where it appears today, and the market half starts empty until
-- somebody merchandises it — which is the honest state for a section that has
-- just opened.

ALTER TABLE app_categories
  ADD COLUMN IF NOT EXISTS merchant_type text NOT NULL DEFAULT 'RESTAURANT';

ALTER TABLE app_categories
  DROP CONSTRAINT IF EXISTS app_categories_merchant_type_check;

ALTER TABLE app_categories
  ADD CONSTRAINT app_categories_merchant_type_check
  CHECK (merchant_type IN ('RESTAURANT', 'MARKET'));

COMMENT ON COLUMN app_categories.merchant_type IS
  'Which storefront this category belongs to. A cuisine tag and a grocery aisle are both categories and never appear together.';

ALTER TABLE app_banners
  ADD COLUMN IF NOT EXISTS merchant_type text NOT NULL DEFAULT 'RESTAURANT';

ALTER TABLE app_banners
  DROP CONSTRAINT IF EXISTS app_banners_merchant_type_check;

ALTER TABLE app_banners
  ADD CONSTRAINT app_banners_merchant_type_check
  CHECK (merchant_type IN ('RESTAURANT', 'MARKET'));

COMMENT ON COLUMN app_banners.merchant_type IS
  'Which storefront this banner runs in. A placement is sold for one of them, not for the app.';

-- `/storefront` asks for one type, ordered, twice per session at most. The
-- existing indexes are on sort order alone and cannot answer the type half.
CREATE INDEX IF NOT EXISTS app_categories_type_idx
  ON app_categories (merchant_type, is_active, sort_order);

CREATE INDEX IF NOT EXISTS app_banners_type_idx
  ON app_banners (merchant_type, is_active, sort_order);

-- The market's own aisles.
--
-- Separate keys rather than reusing the cuisine vocabulary, because `key` is
-- globally unique and because the two lists answer different questions: a
-- cuisine says what a kitchen cooks, an aisle says what a shop stocks. Markets
-- carry these in `cuisine_tags` exactly as restaurants carry cuisines, so the
-- category strip filters through the code that was already there.
--
-- `ON CONFLICT DO NOTHING` so re-running is safe and so a name an operator has
-- since edited in Admin is not overwritten by a migration.
INSERT INTO app_categories (key, name_ar, emoji, sort_order, merchant_type) VALUES
  ('mk_produce',   'خضار وفواكه',      '🥬',  10, 'MARKET'),
  ('mk_dairy',     'ألبان وأجبان',     '🧀',  20, 'MARKET'),
  ('mk_meat',      'لحوم ودواجن',      '🥩',  30, 'MARKET'),
  ('mk_bakery',    'مخبوزات',          '🥖',  40, 'MARKET'),
  ('mk_household', 'منظفات ومنزل',     '🧴',  50, 'MARKET')
ON CONFLICT (key) DO NOTHING;
