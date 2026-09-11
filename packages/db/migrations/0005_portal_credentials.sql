-- ============================================================================
-- 0005: Portal credentials — username, password lifecycle, and lockout.
--
-- Portal users sign in with a username, not a phone number. Two reasons, and
-- neither is cosmetic:
--
--   - A restaurant's portal account is created by Jibli staff before anyone at
--     the restaurant has touched the system. Their phone may not be known, may
--     change, and is shared across a family business. A username is issued.
--   - A phone number is a public identifier. Using it as the login name hands
--     an attacker half of every credential pair for free, and phone numbers
--     for restaurants are printed on their own menus.
--
-- Customers and drivers keep authenticating by OTP and have no username. So an
-- account must carry at least one identifier, but not necessarily both.
-- ============================================================================

ALTER TABLE users ADD COLUMN username text;

-- Portal-only accounts have no phone. The column has to give up NOT NULL, and
-- the identity rule moves into a CHECK so "an account with no way to identify
-- it" stays unrepresentable.
ALTER TABLE users ALTER COLUMN phone_e164 DROP NOT NULL;

ALTER TABLE users
  ADD CONSTRAINT users_has_identifier
  CHECK (phone_e164 IS NOT NULL OR username IS NOT NULL);

/*
 * Usernames are compared case-insensitively.
 *
 * Storing "Sami" and "sami" as different accounts is a phishing aid: an
 * attacker registers the visually identical name and social-engineers from it.
 * The index is on lower(username), so the database refuses the collision
 * regardless of what any application layer forgets to normalise.
 */
CREATE UNIQUE INDEX users_username_key ON users (lower(username)) WHERE username IS NOT NULL;

/*
 * Format is enforced here as well as in Zod.
 *
 * Confusable characters are the attack: Cyrillic а, a zero-width joiner, or a
 * right-to-left override inside a name that is then displayed next to an audit
 * entry. Restricting to lowercase ASCII, digits and three separators makes
 * that impossible rather than unlikely. Must start alphanumeric, 3-32 long.
 */
ALTER TABLE users
  ADD CONSTRAINT users_username_format
  CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');

-- The phone index has to become partial now that the column is nullable:
-- PostgreSQL treats NULLs as distinct, but a partial index states the intent.
DROP INDEX IF EXISTS users_phone_key;
CREATE UNIQUE INDEX users_phone_key ON users (phone_e164) WHERE phone_e164 IS NOT NULL;

-- ── Password lifecycle ──────────────────────────────────────────────────────

/*
 * A credential issued by someone else is known to that someone else.
 *
 * Staff create restaurant portal accounts and read the first password aloud or
 * send it over WhatsApp. Until the owner replaces it, the account is shared.
 * This flag forces that replacement before anything else can be done.
 */
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN password_changed_at timestamptz;

-- ── Lockout ─────────────────────────────────────────────────────────────────

/*
 * Persistent, per-account lockout.
 *
 * The Redis rate limiter caps attempts per IP and per minute, which stops a
 * flood but not a patient attacker rotating addresses against one known
 * username. This counter lives with the account and survives a restart.
 */
ALTER TABLE users ADD COLUMN failed_login_count integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until timestamptz;

ALTER TABLE users
  ADD CONSTRAINT users_failed_login_non_negative CHECK (failed_login_count >= 0);

-- ── Login attempt log ───────────────────────────────────────────────────────

/*
 * Every portal sign-in attempt, successful or not.
 *
 * Separate from audit_logs because the volume and the retention differ: this
 * is security telemetry that answers "is someone spraying passwords across our
 * restaurant accounts", a question audit_logs cannot answer because a failed
 * login changes no entity.
 *
 * `identifier` stores what was typed, not a secret. The password never appears
 * here in any form (plan §1512).
 */
CREATE TABLE login_attempts (
  id            uuid PRIMARY KEY,
  -- Null when the username did not match an account: the attempt still matters.
  user_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  identifier    text NOT NULL,
  succeeded     boolean NOT NULL,
  -- INVALID_PASSWORD, UNKNOWN_USER, LOCKED, MFA_FAILED, NO_PORTAL_ACCESS…
  failure_reason text,
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT login_attempts_reason_matches_outcome
    CHECK ((succeeded AND failure_reason IS NULL) OR (NOT succeeded AND failure_reason IS NOT NULL))
);

-- "Recent failures for this account" and "recent attempts from this address"
-- are the two queries that matter, and both are time-ordered.
CREATE INDEX login_attempts_user_idx ON login_attempts (user_id, created_at DESC);
CREATE INDEX login_attempts_identifier_idx ON login_attempts (lower(identifier), created_at DESC);
CREATE INDEX login_attempts_ip_idx ON login_attempts (ip, created_at DESC) WHERE ip IS NOT NULL;
