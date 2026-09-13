-- The categories the app browses by, and the banners across the top of it.
--
-- Categories were a constant compiled into @jibli/contracts. That was right
-- while the list was a *vocabulary* — something restaurants are tagged with,
-- checked at the API boundary so "دجاج" and "الدجاج" never became two filters.
-- It stops being right the moment the list is also merchandising: an operator
-- who wants a Ramadan category, or wants حلويات above برغر this week, cannot
-- ship a release to do it.
--
-- So the vocabulary moves here. The contract keeps its copy as the seed below
-- and as the fallback for a client that cannot reach the API; the database is
-- what the app reads.

CREATE TABLE app_categories (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Never edited once created: a restaurant carries this string in
  -- cuisine_tags, and renaming it silently orphans every restaurant in the
  -- category. The Arabic name is the part that changes.
  key            text NOT NULL,
  name_ar        text NOT NULL,
  emoji          text,
  image_asset_id uuid REFERENCES assets (id) ON DELETE SET NULL,
  -- Sparse on purpose: new categories land at the end with room to be dragged
  -- between existing ones without renumbering every row.
  sort_order     integer NOT NULL DEFAULT 0,
  -- Hidden rather than deleted. A category with restaurants in it cannot be
  -- removed without orphaning their tags.
  is_active      boolean NOT NULL DEFAULT true,
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT app_categories_key_shape CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  CONSTRAINT app_categories_name_not_blank CHECK (length(btrim(name_ar)) > 0)
);

CREATE UNIQUE INDEX app_categories_key ON app_categories (key);
CREATE INDEX app_categories_order_idx ON app_categories (sort_order);

-- The shipped vocabulary, in the order it was written. Spaced by ten so a
-- category can be moved between two others without rewriting the column for
-- every row after it.
INSERT INTO app_categories (key, name_ar, emoji, sort_order) VALUES
  ('iraqi',       'مأكولات عراقية',            '🍛',  10),
  ('grills',      'مشاوي',                     '🍢',  20),
  ('kebab',       'كباب',                      '🥙',  30),
  ('chicken',     'دجاج',                      '🍗',  40),
  ('meat',        'لحوم',                      '🥩',  50),
  ('fast_food',   'وجبات سريعة',               '🍟',  60),
  ('burger',      'برغر',                      '🍔',  70),
  ('pizza',       'بيتزا',                     '🍕',  80),
  ('shawarma',    'شاورما',                    '🌯',  90),
  ('sandwiches',  'سندويشات',                  '🥪', 100),
  ('breakfast',   'فطور',                      '🍳', 110),
  ('seafood',     'أسماك ومأكولات بحرية',      '🐟', 120),
  ('levantine',   'مأكولات شامية',             '🫓', 130),
  ('turkish',     'مأكولات تركية',             '🥘', 140),
  ('asian',       'مأكولات آسيوية',            '🍜', 150),
  ('italian',     'مأكولات إيطالية',           '🍝', 160),
  ('healthy',     'صحي ودايت',                 '🥗', 170),
  ('desserts',    'حلويات',                    '🍰', 180),
  ('bakery',      'مخبوزات ومعجنات',           '🥐', 190),
  ('ice_cream',   'آيس كريم',                  '🍨', 200),
  ('juices',      'عصائر ومشروبات',            '🥤', 210),
  ('coffee',      'قهوة ومقاهي',               '☕', 220)
ON CONFLICT (key) DO NOTHING;

-- ── Banners ─────────────────────────────────────────────────────────────────

CREATE TABLE app_banners (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_ar       text NOT NULL,
  subtitle_ar    text,
  image_asset_id uuid REFERENCES assets (id) ON DELETE SET NULL,
  link_type      text NOT NULL DEFAULT 'NONE',
  -- A category key, a restaurant id, or a URL, depending on link_type.
  link_value     text,
  sort_order     integer NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  -- Both null means "always", which is the common case. A Ramadan banner that
  -- stops being true on the 30th is why the columns exist rather than relying
  -- on somebody remembering to switch it off.
  starts_at      timestamptz,
  ends_at        timestamptz,
  created_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT app_banners_link_type_check
    CHECK (link_type IN ('NONE','CATEGORY','RESTAURANT','URL')),
  -- A link type that names a destination must have one, and NONE must not.
  CONSTRAINT app_banners_link_value_coherent
    CHECK ((link_type = 'NONE') = (link_value IS NULL)),
  CONSTRAINT app_banners_window_ordered
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX app_banners_order_idx ON app_banners (is_active, sort_order);

-- How long each banner holds the screen. In Admin settings rather than a
-- constant in the app, because it is the kind of number an operator wants to
-- try at four seconds and then at six.
INSERT INTO platform_config (id, key, value, description_ar, is_sensitive, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'banner_rotation_seconds',
  '5'::jsonb,
  'مدة بقاء كل بنر على الشاشة في التطبيق (ثواني)',
  false,
  now(),
  now()
)
ON CONFLICT (key) DO NOTHING;
