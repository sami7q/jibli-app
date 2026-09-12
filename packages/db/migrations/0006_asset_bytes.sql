-- Asset bytes.
--
-- The `assets` table has carried the metadata since the first migration —
-- storage key, bucket, content type, size, owner — and nothing has ever
-- carried the image itself. There is no upload endpoint and no object store,
-- so every restaurant logo and dish photo has been a blank square.
--
-- S3 settings exist in the environment schema but no bucket is provisioned and
-- no credentials are set, and a logo is a few tens of kilobytes. Postgres holds
-- them until there is a reason to run object storage: `bytea` over about 2 KB
-- is TOASTed out of line and compressed, so the row stays small and a query
-- that does not select the column does not pay for it.
--
-- Kept in its own table for the same reason: `select *` on `assets` must never
-- drag image data across the wire. The upload path selects metadata from
-- `assets`; only the one route that serves an image reads from here.
--
-- The swap to object storage later is a change of where these bytes live, not
-- of the schema around them: `assets.storage_key` and `assets.bucket` already
-- describe the object that would replace this row.

CREATE TABLE IF NOT EXISTS asset_bytes (
  asset_id uuid PRIMARY KEY REFERENCES assets (id) ON DELETE CASCADE,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE asset_bytes IS
  'Image bytes for assets stored in the database rather than an object store.';

-- A logo is fetched by the asset row, which is already indexed by restaurant.
-- No additional index: the primary key is the only access path.
