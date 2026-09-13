-- A restaurant talking to Jibli, and Jibli noticing.
--
-- Two gaps that are really one. A restaurant with a problem had exactly one
-- channel: phoning whoever they happened to know. Nothing was recorded, nobody
-- else could pick it up, and the same question got a different answer twice.
-- And on the other side, Jibli had no way to learn that anything had happened
-- at all — an application, an activation request, a restaurant asking for help
-- all sat in the database waiting for somebody to think of checking.
--
-- So: threads, and a bell.

-- ── Support ─────────────────────────────────────────────────────────────────
--
-- The thread belongs to the restaurant, not to the person who opened it. Staff
-- change; the record of what Jibli told this restaurant about its settlement
-- has to outlive the manager who asked.
CREATE TABLE support_threads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  opened_by         uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  subject           text NOT NULL,
  topic             text NOT NULL DEFAULT 'OTHER',
  status            text NOT NULL DEFAULT 'OPEN',
  priority          text NOT NULL DEFAULT 'NORMAL',
  -- Denormalised from the messages: the queue sorts by it on every load, and
  -- deriving it means a correlated subquery per row over the table that grows
  -- fastest in this pair.
  last_message_at   timestamptz NOT NULL DEFAULT now(),
  last_message_from text NOT NULL DEFAULT 'RESTAURANT',
  resolved_at       timestamptz,
  resolved_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT support_threads_topic_check
    CHECK (topic IN ('ORDERS','MENU','FINANCE','ACCOUNT','TECHNICAL','OTHER')),
  -- Two "waiting" states rather than one: the queue an operator works is "who
  -- is waiting for me", and a single OPEN flag cannot express that.
  CONSTRAINT support_threads_status_check
    CHECK (status IN ('OPEN','ANSWERED','RESOLVED')),
  CONSTRAINT support_threads_priority_check CHECK (priority IN ('NORMAL','URGENT')),
  CONSTRAINT support_threads_side_check CHECK (last_message_from IN ('RESTAURANT','JIBLI')),
  CONSTRAINT support_threads_resolved_coherent
    CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL))
);

CREATE INDEX support_threads_status_idx ON support_threads (status, last_message_at);
CREATE INDEX support_threads_restaurant_idx ON support_threads (restaurant_id, last_message_at DESC);

CREATE TABLE support_messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id            uuid NOT NULL REFERENCES support_threads (id) ON DELETE CASCADE,
  -- Stored rather than inferred from the author's roles: a Jibli operator who
  -- later also owns a restaurant must not retroactively turn their old replies
  -- into restaurant messages.
  author_side          text NOT NULL,
  author_user_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  author_name_snapshot text NOT NULL,
  body                 text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT support_messages_side_check CHECK (author_side IN ('RESTAURANT','JIBLI')),
  CONSTRAINT support_messages_body_not_blank CHECK (length(btrim(body)) > 0)
);

CREATE INDEX support_messages_thread_idx ON support_messages (thread_id, created_at);

-- ── The bell ────────────────────────────────────────────────────────────────
--
-- Not notification_deliveries, which is the outbound channel to a customer's
-- phone. This is in-app, addressed to whoever is on duty rather than to one
-- person, and never sent anywhere.
CREATE TABLE admin_notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL,
  severity      text NOT NULL DEFAULT 'INFO',
  title_ar      text NOT NULL,
  body_ar       text,
  -- Where the bell takes you. A notification you cannot act on is noise.
  link_path     text,
  entity_type   text,
  entity_id     text,
  restaurant_id uuid REFERENCES restaurants (id) ON DELETE CASCADE,
  -- Collapses repeats. A restaurant that sends four messages before anyone
  -- looks should leave one unread entry, not four: the operator opens the
  -- thread and sees all four.
  dedupe_key    text,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT admin_notifications_kind_check CHECK (kind IN (
    'APPLICATION_RECEIVED','ACTIVATION_REQUESTED','SUPPORT_MESSAGE',
    'SETTLEMENT_OVERDUE','ORDER_CANCELLED','REVIEW_POSTED'
  )),
  CONSTRAINT admin_notifications_severity_check
    CHECK (severity IN ('INFO','ATTENTION','URGENT'))
);

CREATE INDEX admin_notifications_created_idx ON admin_notifications (created_at DESC);
CREATE UNIQUE INDEX admin_notifications_dedupe_key
  ON admin_notifications (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Read state is its own table, not a column. A notification is one fact about
-- the platform and two operators must be able to have seen it independently; a
-- read_at column would let whoever looked first mark it read for everybody.
CREATE TABLE admin_notification_reads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES admin_notifications (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX admin_notification_reads_unique
  ON admin_notification_reads (notification_id, user_id);
CREATE INDEX admin_notification_reads_user_idx ON admin_notification_reads (user_id);

-- Two settings the code above reads, seeded so Admin sees them with a value
-- rather than a blank that looks like a bug.
INSERT INTO platform_config (id, key, value, description_ar, is_sensitive, created_at, updated_at)
VALUES
  (
    gen_random_uuid(),
    'review_delay_minutes',
    '15'::jsonb,
    'المدة بعد استلام الطلب قبل أن يتمكن العميل من التقييم (دقائق)',
    false,
    now(),
    now()
  )
ON CONFLICT (key) DO NOTHING;
