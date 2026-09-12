-- A restaurant asking to go live.
--
-- The readiness checklist (plan §122) has always existed on the Admin side:
-- twelve checks, and a restaurant cannot be activated until the blocking ones
-- pass. What was missing is the other half of that conversation. The restaurant
-- sets up its menu, hours, drivers and alert test with no way to say "we are
-- ready", and Admin has no queue to work from — only a list of restaurants and
-- no signal about which of them is waiting.
--
-- So: the restaurant submits, Admin sees a queue, Admin activates.
--
-- Two columns rather than a table, because a restaurant has at most one open
-- request. Submitting again overwrites the note and the timestamp, which is
-- what "I updated it, please look again" means; activation clears both.
--
-- The note is the restaurant's own words to whoever reviews it. It is shown in
-- Admin and written to the audit trail with the decision.

ALTER TABLE restaurants
  ADD COLUMN IF NOT EXISTS activation_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS activation_request_note text;

COMMENT ON COLUMN restaurants.activation_requested_at IS
  'When the restaurant last asked to be activated. NULL once activated or withdrawn.';

-- The queue is "restaurants waiting", which is a small slice of the table and
-- read on every Admin dashboard load. A partial index keeps it that size
-- rather than the size of the platform.
CREATE INDEX IF NOT EXISTS restaurants_activation_pending_idx
  ON restaurants (activation_requested_at)
  WHERE activation_requested_at IS NOT NULL AND deleted_at IS NULL;
