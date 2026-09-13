-- A step-up can be answered with a password.
--
-- Sensitive actions — changing a commission, voiding a statement, assigning a
-- role — demand proof that the session still belongs to the person who opened
-- it. That proof was a TOTP code and nothing else, which works only for an
-- account that has enrolled an authenticator. An account that has not cannot
-- answer at all, so the action is not protected, it is unreachable.
--
-- The password is the weaker answer and is accepted only from an account with
-- no authenticator; one that has enrolled must still use it, or a stolen
-- password alone would reach exactly what enrolling was meant to protect.
--
-- `mfa_attempts` records the outcome either way: the lockout window guards the
-- step-up, not one particular way of answering it.

ALTER TABLE mfa_attempts DROP CONSTRAINT IF EXISTS mfa_attempts_method_check;

ALTER TABLE mfa_attempts
  ADD CONSTRAINT mfa_attempts_method_check
  CHECK (method IN ('TOTP', 'RECOVERY_CODE', 'PASSWORD'));

-- Whether enrolment is enforced becomes an operational decision rather than a
-- constant. A one-person pilot and a platform with a finance team are not the
-- same operation, and only one of them can afford a locked-out owner.
INSERT INTO platform_config (id, key, value, description_ar, is_sensitive, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'require_mfa',
  'false'::jsonb,
  'إلزام فريق المنصة بتفعيل التحقق بخطوتين قبل استخدام اللوحة',
  true,
  now(),
  now()
)
ON CONFLICT (key) DO NOTHING;
