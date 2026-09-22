-- An order that is ready and going nowhere.
--
-- The order lifecycle had no timeout anywhere in it. A restaurant marks an
-- order READY and then has to assign a driver by hand — there is no automatic
-- dispatch, by design — so if nobody does, the order simply sits. The kitchen
-- believes it is handled, the customer watches a status that will not change,
-- and the food goes cold. Nothing in the platform noticed, because nothing was
-- watching: every scheduled job in the worker was financial.
--
-- The worker now sweeps for these and raises a bell entry. This migration only
-- widens the CHECK constraint so the new kind can be stored — the sweep itself
-- is `apps/worker/src/jobs/stalled-orders.ts`.
--
-- Deliberately a new kind rather than reusing ORDER_CANCELLED. An operator
-- filtering the bell for cancellations should not have stalled orders mixed in:
-- they are opposite situations. One is finished and one is waiting for someone.

ALTER TABLE admin_notifications
  DROP CONSTRAINT admin_notifications_kind_check;

ALTER TABLE admin_notifications
  ADD CONSTRAINT admin_notifications_kind_check CHECK (kind IN (
    'APPLICATION_RECEIVED','ACTIVATION_REQUESTED','SUPPORT_MESSAGE',
    'SETTLEMENT_OVERDUE','ORDER_CANCELLED','REVIEW_POSTED',
    'ORDER_STALLED'
  ));

-- The sweep asks the same question on every run: which orders are READY and
-- have been for longer than the threshold. Without this it is a sequential scan
-- of the whole orders table, every few minutes, forever.
--
-- Partial, because the answer only ever concerns one status and that status
-- holds a handful of rows at a time out of everything the table will accumulate.
CREATE INDEX IF NOT EXISTS orders_ready_since_idx
  ON orders (ready_at)
  WHERE status = 'READY';
