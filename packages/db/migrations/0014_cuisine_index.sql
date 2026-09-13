-- Finding restaurants by category.
--
-- `cuisine_tags` is jsonb, and containment (`@>`) against it is a sequential
-- scan without a GIN index. That is free at one restaurant and is the query
-- behind three things that will run constantly: the category filter on the
-- Admin directory, the count beside every category on the categories screen,
-- and — once the customer app ships — browsing a category at all.
--
-- `jsonb_path_ops` rather than the default operator class: it indexes only the
-- containment operator, which is the only one used here, and is smaller and
-- faster for it than the general form.

CREATE INDEX IF NOT EXISTS restaurants_cuisine_tags_idx
  ON restaurants USING gin (cuisine_tags jsonb_path_ops);

COMMENT ON INDEX restaurants_cuisine_tags_idx IS
  'Containment lookups: cuisine_tags @> jsonb_build_array(key).';
