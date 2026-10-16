-- Sign-in for the sample shops' owner accounts, switched off.
--
-- Migration 0020 opened six sample shops — markets and cosmetics, so those
-- sections were not empty — and gave each an owner account with a fixed
-- username and an argon2 hash, in a file that now sits in a public
-- repository. A hash in public is a target for offline guessing, and an owner
-- account opens a shop's prices, menu and orders. The shops stay; the logins
-- go.
--
-- Exactly the six usernames 0020 wrote, and only where that user owns the
-- sample shop 0020 created alongside it (matched by its DEMO- partner code),
-- so no other account can be caught by a name that happens to match. For each:
--
--   password_hash  NULL         — nothing left to guess; the login answers
--                                 «invalid credentials» as for an unknown name
--   status         DEACTIVATED  — refused even if a password were set again
--   sessions       deleted      — anyone already signed in is signed out
--
-- The shops, their products, photos and orders, and the membership rows are
-- untouched: what a customer sees does not depend on the owner's account, and
-- the activation checklist reads the membership, not the user. Reviewer
-- accounts (REVIEW-GP-1) are not in the list. Safe to run again.

CREATE TEMP TABLE sample_shop_logins ON COMMIT DROP AS
SELECT DISTINCT u.id
FROM (VALUES
  ('demo.market', 'DEMO-2001'),
  ('demo.baqala', 'DEMO-2002'),
  ('demo.haditha.market', 'DEMO-2007'),
  ('demo.cosmetics', 'DEMO-3001'),
  ('demo.perfume', 'DEMO-3002'),
  ('demo.haditha.beauty', 'DEMO-3003')
) AS sample (username, partner_code)
JOIN users u ON lower(u.username) = sample.username
JOIN restaurant_members m ON m.user_id = u.id
JOIN restaurants r ON r.id = m.restaurant_id AND r.partner_code = sample.partner_code;

DELETE FROM sessions WHERE user_id IN (SELECT id FROM sample_shop_logins);

UPDATE users
SET password_hash = NULL,
    status = 'DEACTIVATED',
    must_change_password = false,
    updated_at = now()
WHERE id IN (SELECT id FROM sample_shop_logins);
