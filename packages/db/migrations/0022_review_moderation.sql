-- User-generated content: terms acceptance, screening, reports, blocks.
--
-- A review's comment is text one person writes and others read — the shop
-- that received the order, and anyone reading a shop's public reviews. Both
-- stores require four things of an app that carries that: the author agrees
-- to content rules before posting, objectionable text is filtered, a reader
-- can report it and block its author, and someone acts on reports. Hiding
-- (`is_hidden`, moderated by Admin) already existed; this adds the rest.
--
-- Additive only. Every existing review keeps its visibility; none is held.

ALTER TABLE order_reviews
  -- When the author accepted the content rules. Null on a rating with no
  -- comment, and on every review written before the rules were asked for.
  ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
  -- Why the review is waiting for a moderator rather than published:
  -- the screen matched something (PROFANITY, CONTACT, LINK) or readers
  -- reported it (REPORTED). Null once a moderator decides, and on any
  -- review that was never held.
  ADD COLUMN IF NOT EXISTS held_reason text,
  ADD COLUMN IF NOT EXISTS moderated_at timestamptz;

-- The moderation queue reads held reviews newest first.
CREATE INDEX IF NOT EXISTS order_reviews_held_idx
  ON order_reviews (created_at DESC)
  WHERE held_reason IS NOT NULL;

CREATE TABLE IF NOT EXISTS review_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id         uuid NOT NULL REFERENCES order_reviews (id) ON DELETE CASCADE,
  reporter_user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason            text NOT NULL,
  note              text,
  status            text NOT NULL DEFAULT 'OPEN',
  resolved_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT review_reports_reason_check
    CHECK (reason IN ('ABUSIVE', 'SPAM', 'PERSONAL_DATA', 'FALSE', 'OTHER')),
  CONSTRAINT review_reports_status_check
    CHECK (status IN ('OPEN', 'ACTIONED', 'DISMISSED'))
);

-- One report per person per review: a second tap is the same complaint.
CREATE UNIQUE INDEX IF NOT EXISTS review_reports_once
  ON review_reports (review_id, reporter_user_id);
CREATE INDEX IF NOT EXISTS review_reports_open_idx
  ON review_reports (status, created_at DESC);

CREATE TABLE IF NOT EXISTS user_blocks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked_user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_blocks_not_self CHECK (blocker_user_id <> blocked_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS user_blocks_pair
  ON user_blocks (blocker_user_id, blocked_user_id);
CREATE INDEX IF NOT EXISTS user_blocks_blocked_idx
  ON user_blocks (blocked_user_id);
