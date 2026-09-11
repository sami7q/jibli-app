-- ============================================================================
-- 0004: Indexes for the dashboard aggregates.
--
-- The Admin and Restaurant home screens each run a handful of aggregates over
-- orders on every load. The indexes from 0001 were built for the live board and
-- for order lookup, and none of them supports a *range scan on completed_at*:
--
--   orders_restaurant_status_idx  (restaurant_id, status, created_at DESC)
--   orders_status_idx             (status, placed_at)
--
-- Filtering `status = 'COMPLETED' AND completed_at >= $1` against either one
-- leaves the range predicate unindexed, so the planner reads every completed
-- order the restaurant has ever had and discards most of them. That is fine at
-- a hundred orders and is a sequential scan of the largest table in the system
-- at a hundred thousand.
--
-- These are written as PARTIAL indexes on the completed rows. A dashboard never
-- aggregates a cancelled or in-flight order, and excluding them keeps the index
-- to the rows that are actually scanned.
-- ============================================================================

-- Restaurant dashboard: today, yesterday and the seven-day series, all scoped
-- to one restaurant and ordered by completion.
CREATE INDEX orders_restaurant_completed_idx
  ON orders (restaurant_id, completed_at)
  WHERE status = 'COMPLETED';

-- Admin dashboard: the same aggregates across every restaurant, plus the
-- 30-day trend and the top-restaurants leaderboard.
CREATE INDEX orders_completed_at_idx
  ON orders (completed_at)
  WHERE status = 'COMPLETED';

-- "Newest orders" on the Admin home screen: an unfiltered ORDER BY placed_at
-- DESC LIMIT 6. Every existing index leads with another column, so without this
-- the query sorts the whole table to return six rows.
CREATE INDEX orders_placed_at_idx ON orders (placed_at DESC);

-- The activity feed reads the newest audit rows with no filter at all. The
-- three indexes from 0001 all lead with entity, actor or action, none of which
-- this query constrains.
CREATE INDEX audit_logs_recent_idx ON audit_logs (created_at DESC);

-- Low-stock panel and the inventory screen's alert count. Only tracked items
-- carry a threshold, so the partial predicate keeps this index small.
CREATE INDEX inventory_items_low_stock_idx
  ON inventory_items (restaurant_id)
  WHERE low_stock_threshold IS NOT NULL;

-- Best sellers groups order_items by menu_item_id after joining orders. The
-- join uses order_items_order_idx; this one serves the grouping and the
-- per-item history the menu screen shows.
CREATE INDEX order_items_menu_item_idx ON order_items (menu_item_id);

-- Restaurant order history pages by (restaurant_id, placed_at DESC) with a
-- keyset cursor. orders_restaurant_status_idx only helps when a status filter
-- is supplied; the default "everything finished" view has none.
CREATE INDEX orders_restaurant_placed_idx ON orders (restaurant_id, placed_at DESC);
