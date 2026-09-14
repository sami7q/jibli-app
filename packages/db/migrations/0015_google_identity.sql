-- ============================================================================
-- 0015: Google as a second way in, with the phone still mandatory to order.
--
-- Sign-in was phone-only. Adding Google is a product decision with a store
-- consequence worth stating: App Store guideline 4.8 requires Sign in with
-- Apple alongside any third-party social login, so the day this ships on iOS,
-- Apple's must ship with it. The columns here are shaped for that — a provider
-- subject id and an email — rather than for Google alone.
--
-- The important rule is that Google does NOT replace the phone. An order needs
-- a number a driver can call, so a Google account can browse and must verify a
-- phone before it can check out. `phone_verified_at` already existed and is
-- what enforces it; nothing new is needed for that.
-- ============================================================================

ALTER TABLE users ADD COLUMN email text;
ALTER TABLE users ADD COLUMN google_sub text;

/*
 * An account needs *a* way to be identified.
 *
 * The original rule was phone-or-username (migration 0005). A Google user has
 * neither at the moment they first sign in, so the constraint widens rather
 * than being dropped: "an account with no way to identify it" stays
 * unrepresentable, which is the property worth keeping.
 */
ALTER TABLE users DROP CONSTRAINT users_has_identifier;
ALTER TABLE users
  ADD CONSTRAINT users_has_identifier
  CHECK (phone_e164 IS NOT NULL OR username IS NOT NULL OR google_sub IS NOT NULL);

/*
 * One account per Google identity, and one per email.
 *
 * Partial, because the columns are null for every phone-only customer and a
 * plain unique index would allow exactly one of them.
 *
 * The email index is case-insensitive: Google normalises addresses, but a
 * second provider later may not, and "Ali@x.com" and "ali@x.com" being two
 * accounts is the kind of duplicate nobody notices until support does.
 */
CREATE UNIQUE INDEX users_google_sub_key ON users (google_sub) WHERE google_sub IS NOT NULL;
CREATE UNIQUE INDEX users_email_key ON users (lower(email)) WHERE email IS NOT NULL;

COMMENT ON COLUMN users.google_sub IS
  'Google''s stable subject id. Never the email: a Google account can change its address.';
COMMENT ON COLUMN users.email IS
  'From the identity provider. Not a login credential and never used to send an OTP.';
