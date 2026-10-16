-- The sample shops, retired before launch — and every sample login with them.
--
-- Production was found holding twelve sample shops and no real one: the six
-- restaurants the demo seed wrote (DEMO-10xx) and the six markets and
-- cosmetics shops of migration 0020 (DEMO-20xx, DEMO-30xx). Each was APPROVED,
-- ACTIVE, open — most of them around the clock — listed with an invented
-- rating («312 تقييماً»), and able to take a real order. Nobody receives those
-- orders: the sample owners have no device and, since 0023, some have no
-- login at all, so a customer — or an App Reviewer — who ordered would wait
-- for food that was never going to come. Invented ratings beside real prices
-- are the misrepresentation both stores reject (App Store 2.1 / 5.6, Play's
-- Misrepresentation policy).
--
-- And the six seeded restaurants still had working owner accounts whose
-- password is `DEMO_PASSWORD` in packages/db/src/seed/demo-marketplace.ts, in a
-- public repository: an owner session opens a shop's orders, and an order
-- carries a customer's name, phone and address. 0023 switched off the six
-- 0020 logins; this does the same for every sample login the seed can write.
--
-- What it does, matched on the exact partner codes and usernames the seed and
-- 0020 use — never a pattern — so no real shop or account can be caught:
--
--   shops     SUSPENDED with a reason, as Admin → «إيقاف» does; hidden from
--             every listing and refused at checkout
--   branches  accepts_orders false — no new order, from any path
--   ratings   recomputed from the reviews that exist (none, for a sample
--             shop), so a reinstated shop cannot reappear with an invented score
--   logins    password NULL, DEACTIVATED, sessions deleted — exactly as 0023
--
-- What it leaves: the shops, products, photos, memberships and any order
-- already placed. Orders in flight are left for staff to close in Admin, as
-- suspending from Admin leaves them, because cancelling here would bypass the
-- order state machine and its notifications. The review market (REVIEW-GP-1)
-- and its accounts are not in the list. Safe to run again.
--
-- The demo seed skips a shop retired here (`isRetiredSample` in
-- demo-marketplace.ts), so `pnpm db:seed` under a non-production APP_ENV cannot
-- reopen it. On a development database, `pnpm db:reset` brings the samples back.

CREATE TEMP TABLE sample_shop ON COMMIT DROP AS
SELECT r.id, sample.username
FROM (VALUES
  ('DEMO-1001', 'demo.mandi'),
  ('DEMO-1002', 'demo.burger'),
  ('DEMO-1003', 'demo.pizza'),
  ('DEMO-1004', 'demo.shawarma'),
  ('DEMO-1005', 'demo.sweets'),
  ('DEMO-1006', 'demo.grill'),
  ('DEMO-2001', 'demo.market'),
  ('DEMO-2002', 'demo.baqala'),
  ('DEMO-2003', 'demo.khudar'),
  ('DEMO-2004', 'demo.hyper'),
  ('DEMO-2005', 'demo.malhama'),
  ('DEMO-2006', 'demo.alban'),
  ('DEMO-2007', 'demo.haditha.market'),
  ('DEMO-3001', 'demo.cosmetics'),
  ('DEMO-3002', 'demo.perfume'),
  ('DEMO-3003', 'demo.haditha.beauty')
) AS sample (partner_code, username)
JOIN restaurants r ON r.partner_code = sample.partner_code;

UPDATE restaurants r
SET operational_status = 'SUSPENDED',
    suspended_at = COALESCE(r.suspended_at, now()),
    suspended_reason = 'retired: sample shop (migration 0024)',
    rating_count = (
      SELECT count(*) FROM order_reviews v
      WHERE v.restaurant_id = r.id AND v.is_hidden = false
    ),
    rating_average = (
      SELECT round(avg(v.rating)::numeric, 1)::double precision FROM order_reviews v
      WHERE v.restaurant_id = r.id AND v.is_hidden = false
    ),
    updated_at = now()
WHERE r.id IN (SELECT id FROM sample_shop);

UPDATE restaurant_branches
SET accepts_orders = false,
    updated_at = now()
WHERE restaurant_id IN (SELECT id FROM sample_shop)
  AND accepts_orders = true;

CREATE TEMP TABLE sample_login ON COMMIT DROP AS
SELECT DISTINCT u.id
FROM sample_shop s
JOIN users u ON lower(u.username) = s.username
JOIN restaurant_members m ON m.user_id = u.id AND m.restaurant_id = s.id;

DELETE FROM sessions WHERE user_id IN (SELECT id FROM sample_login);

UPDATE users
SET password_hash = NULL,
    status = 'DEACTIVATED',
    must_change_password = false,
    updated_at = now()
WHERE id IN (SELECT id FROM sample_login);
