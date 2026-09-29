-- The kind of shop an applicant is applying as.
--
-- The public «انضم إلى جيبلي» form asked every applicant for a restaurant name
-- and a cuisine, and approval always created a restaurant. A cosmetics shop or
-- a market that applied landed in the food tab with food categories, and could
-- only be fixed by hand. The application now carries the same discriminator
-- the shop it becomes will carry, and approval copies it across.
--
-- Defaulted to RESTAURANT so every application already waiting keeps the
-- meaning it was submitted with.

ALTER TABLE restaurant_applications
  ADD COLUMN IF NOT EXISTS merchant_type text NOT NULL DEFAULT 'RESTAURANT';

ALTER TABLE restaurant_applications
  DROP CONSTRAINT IF EXISTS restaurant_applications_merchant_type_check;

ALTER TABLE restaurant_applications
  ADD CONSTRAINT restaurant_applications_merchant_type_check
  CHECK (merchant_type IN ('RESTAURANT', 'MARKET', 'COSMETICS'));
