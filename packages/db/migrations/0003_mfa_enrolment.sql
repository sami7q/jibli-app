-- =============================================================================
-- MFA enrolment (plan §88)
--
-- "MFA is mandatory for Super Admin and Finance Admin before production
-- launch." The step-up check already exists; this adds the state it needs.
-- =============================================================================

-- Blocks replay of an observed code inside its own 30-second window.
ALTER TABLE users
  ADD COLUMN mfa_last_used_counter bigint;

-- Enrolment is two-phase: a secret is generated and stored pending, and only
-- becomes active once the user proves they can produce a code from it. Without
-- this an admin could lock themselves out by scanning a QR that never worked.
ALTER TABLE users
  ADD COLUMN mfa_pending_secret_encrypted text,
  ADD COLUMN mfa_pending_started_at timestamptz;

-- An enrolment that is confirmed must have a secret to confirm against.
ALTER TABLE users
  ADD CONSTRAINT users_mfa_enabled_has_secret CHECK (
    mfa_enabled_at IS NULL OR mfa_secret_encrypted IS NOT NULL
  );

CREATE TABLE mfa_recovery_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- HMAC of the normalised code with the server pepper. The plaintext is shown
  -- once at enrolment and never stored.
  code_hash   text NOT NULL,
  used_at     timestamptz,
  -- Recorded so an unexpected recovery use can be investigated.
  used_ip     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- One row per distinct code; a collision would let one code consume another.
CREATE UNIQUE INDEX mfa_recovery_codes_hash_key ON mfa_recovery_codes (code_hash);
CREATE INDEX mfa_recovery_codes_user_idx ON mfa_recovery_codes (user_id, used_at);

-- Rate-limit state for MFA verification. Kept in the database rather than Redis
-- because locking an admin account out is a security decision that must survive
-- a cache flush.
CREATE TABLE mfa_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  succeeded   boolean NOT NULL,
  -- 'TOTP' or 'RECOVERY_CODE'. The submitted value is never stored.
  method      text NOT NULL,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mfa_attempts_method_check CHECK (method IN ('TOTP', 'RECOVERY_CODE'))
);

CREATE INDEX mfa_attempts_user_idx ON mfa_attempts (user_id, created_at DESC);
