-- Markets, as a kind of merchant rather than a parallel system.
--
-- Jibli sells two things now: prepared food from restaurants, and groceries
-- from markets. The temptation is a second set of tables — markets,
-- market_branches, market_products — and it is the expensive answer. Almost
-- nothing differs: both are a partner with branches, a catalog priced per
-- item, orders placed against a branch, a courier, a commission, a portal, and
-- an Admin directory. Duplicating that means every fix to ordering is made
-- twice and every new feature is built twice, forever.
--
-- So one column. `restaurants` keeps its name — renaming a table that fourteen
-- route modules, twenty portal pages and twenty-seven Admin pages reach into
-- is churn that buys nothing — and gains a discriminator. What reads oddly in
-- the schema reads correctly everywhere a customer looks, because the app
-- says «مطعم» or «ماركت» from this column.
--
-- The difference that is real, and that this migration does not try to solve:
-- a restaurant has forty items and a market has thousands. That is a search
-- and pagination problem for the catalog, not a modelling one, and it is
-- solved where it appears rather than by inventing a second schema in advance.

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS merchant_type text NOT NULL DEFAULT 'RESTAURANT';

-- Constrained rather than free text: an unknown value here would not fail, it
-- would quietly drop the merchant out of both storefronts — visible to nobody
-- except the owner wondering why their shop vanished.
ALTER TABLE restaurants
  DROP CONSTRAINT IF EXISTS restaurants_merchant_type_check;

ALTER TABLE restaurants
  ADD CONSTRAINT restaurants_merchant_type_check
  CHECK (merchant_type IN ('RESTAURANT', 'MARKET'));

COMMENT ON COLUMN restaurants.merchant_type IS
  'RESTAURANT (prepared food) or MARKET (groceries). Decides which storefront the merchant appears in and the words the portal uses for its catalog.';

-- The home screen asks "every open merchant of this type in this city" on
-- every load, for each of the two tabs. Without this it is a filter applied
-- after a scan of the whole directory; the existing indexes are on status and
-- city and cannot answer the type half.
CREATE INDEX IF NOT EXISTS restaurants_merchant_type_idx
  ON restaurants (merchant_type, operational_status);

COMMENT ON INDEX restaurants_merchant_type_idx IS
  'Storefront split: open merchants of one type, which is the query behind both tabs of the home screen.';
