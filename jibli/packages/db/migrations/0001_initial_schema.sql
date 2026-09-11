-- =============================================================================
-- Jibli — initial schema
--
-- Hand-written so the constraints of plan §99 are explicit: they are the final
-- protection against races that application validation cannot win.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;       -- Arabic trigram search (plan §58)

-- =============================================================================
-- GEOGRAPHY (plan §8, Appendix B)
-- Capabilities default FALSE: master data exists, service coverage does not,
-- until Operations activates it (plan §9).
-- =============================================================================

CREATE TABLE governorates (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                          text NOT NULL,
  name_ar                       text NOT NULL,
  name_en_internal              text,
  is_enabled                    boolean NOT NULL DEFAULT false,
  customer_signup_enabled       boolean NOT NULL DEFAULT false,
  restaurant_onboarding_enabled boolean NOT NULL DEFAULT false,
  ordering_enabled              boolean NOT NULL DEFAULT false,
  sort_order                    integer NOT NULL DEFAULT 0,
  source_version                text NOT NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT governorates_name_ar_not_blank CHECK (btrim(name_ar) <> '')
);
CREATE UNIQUE INDEX governorates_code_key ON governorates (code);
CREATE INDEX governorates_ordering_idx ON governorates (ordering_enabled, sort_order);

CREATE TABLE cities (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  governorate_id                uuid NOT NULL REFERENCES governorates (id) ON DELETE RESTRICT,
  code                          text NOT NULL,
  name_ar                       text NOT NULL,
  name_en_internal              text,
  is_enabled                    boolean NOT NULL DEFAULT false,
  customer_signup_enabled       boolean NOT NULL DEFAULT false,
  restaurant_onboarding_enabled boolean NOT NULL DEFAULT false,
  ordering_enabled              boolean NOT NULL DEFAULT false,
  sort_order                    integer NOT NULL DEFAULT 0,
  source_version                text NOT NULL,
  deprecated_at                 timestamptz,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cities_name_ar_not_blank CHECK (btrim(name_ar) <> '')
);
CREATE UNIQUE INDEX cities_code_key ON cities (code);
CREATE INDEX cities_governorate_ordering_idx ON cities (governorate_id, ordering_enabled);
CREATE INDEX cities_governorate_sort_idx ON cities (governorate_id, sort_order);

-- =============================================================================
-- IDENTITY (plan §10–§13)
-- =============================================================================

CREATE TABLE users (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164              text NOT NULL,
  phone_verified_at       timestamptz,
  full_name               text,
  profile_governorate_id  uuid REFERENCES governorates (id) ON DELETE RESTRICT,
  profile_city_id         uuid REFERENCES cities (id) ON DELETE RESTRICT,
  preferred_language      text NOT NULL DEFAULT 'AR',
  profile_completed_at    timestamptz,
  status                  text NOT NULL DEFAULT 'ACTIVE',
  password_hash           text,
  mfa_secret_encrypted    text,
  mfa_enabled_at          timestamptz,
  last_login_at           timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,
  CONSTRAINT users_status_check CHECK (status IN ('ACTIVE','SUSPENDED','DEACTIVATED')),
  -- E.164 for Iraq: +964 followed by 10 subscriber digits.
  CONSTRAINT users_phone_e164_format CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  -- A completed profile must carry both halves of its geography (plan §11).
  CONSTRAINT users_profile_geography_complete CHECK (
    profile_completed_at IS NULL
    OR (profile_governorate_id IS NOT NULL AND profile_city_id IS NOT NULL AND full_name IS NOT NULL)
  )
);
CREATE UNIQUE INDEX users_phone_key ON users (phone_e164);
CREATE INDEX users_status_idx ON users (status);
CREATE INDEX users_profile_city_idx ON users (profile_city_id);

CREATE TABLE user_platform_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role        text NOT NULL,
  granted_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  CONSTRAINT user_platform_roles_role_check CHECK (role IN (
    'SUPER_ADMIN','OPERATIONS_ADMIN','FINANCE_ADMIN','RESTAURANT_ONBOARDING',
    'SUPPORT_AGENT','MARKETING','ANALYST','AUDITOR'
  ))
);
CREATE UNIQUE INDEX user_platform_roles_unique ON user_platform_roles (user_id, role);
CREATE INDEX user_platform_roles_user_idx ON user_platform_roles (user_id);

CREATE TABLE otp_challenges (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164          text NOT NULL,
  code_hash           text NOT NULL,
  purpose             text NOT NULL DEFAULT 'LOGIN',
  attempt_count       integer NOT NULL DEFAULT 0,
  max_attempts        integer NOT NULL DEFAULT 5,
  expires_at          timestamptz NOT NULL,
  consumed_at         timestamptz,
  request_ip          text,
  request_user_agent  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT otp_attempts_non_negative CHECK (attempt_count >= 0)
);
CREATE INDEX otp_challenges_phone_idx ON otp_challenges (phone_e164, created_at DESC);
CREATE INDEX otp_challenges_expiry_idx ON otp_challenges (expires_at);

CREATE TABLE sessions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  refresh_token_hash        text NOT NULL,
  superseded_by_session_id  uuid,
  user_agent                text,
  ip                        text,
  device_id                 text,
  mfa_verified_at           timestamptz,
  expires_at                timestamptz NOT NULL,
  revoked_at                timestamptz,
  revoked_reason            text,
  last_used_at              timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sessions_refresh_hash_key ON sessions (refresh_token_hash);
CREATE INDEX sessions_user_idx ON sessions (user_id, created_at DESC);

CREATE TABLE user_addresses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  label           text,
  governorate_id  uuid NOT NULL REFERENCES governorates (id) ON DELETE RESTRICT,
  city_id         uuid NOT NULL REFERENCES cities (id) ON DELETE RESTRICT,
  district_text   text,
  street          text,
  building        text,
  floor           text,
  landmark        text,
  latitude        double precision,
  longitude       double precision,
  delivery_notes  text,
  is_default      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT user_addresses_lat_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT user_addresses_lng_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);
CREATE INDEX user_addresses_user_idx ON user_addresses (user_id);
CREATE INDEX user_addresses_city_idx ON user_addresses (city_id);
-- At most one default address per customer.
CREATE UNIQUE INDEX user_addresses_one_default
  ON user_addresses (user_id) WHERE is_default AND deleted_at IS NULL;

CREATE TABLE user_devices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform       text NOT NULL,
  push_token     text NOT NULL,
  app_version    text,
  os_version     text,
  device_model   text,
  last_seen_at   timestamptz,
  revoked_at     timestamptz,
  revoked_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_devices_platform_check CHECK (platform IN ('IOS','ANDROID','WEB'))
);
CREATE UNIQUE INDEX user_devices_token_key ON user_devices (push_token);
CREATE INDEX user_devices_user_idx ON user_devices (user_id, revoked_at);

CREATE TABLE audit_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  actor_role     text,
  action         text NOT NULL,
  entity_type    text NOT NULL,
  entity_id      text,
  before_json    jsonb,
  after_json     jsonb,
  reason         text,
  ip             text,
  user_agent     text,
  request_id     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);

-- =============================================================================
-- PROVIDERS, RESTAURANTS, BRANCHES (plan §15–§18)
-- =============================================================================

CREATE TABLE providers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_type text NOT NULL DEFAULT 'RESTAURANT',
  status        text NOT NULL DEFAULT 'PENDING',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT providers_type_check CHECK (provider_type IN
    ('RESTAURANT','WATER_FACTORY','WATER_TANKER','GAS_PROVIDER','GROCERY'))
);
CREATE INDEX providers_type_idx ON providers (provider_type, status);

CREATE TABLE restaurants (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id        uuid NOT NULL REFERENCES providers (id) ON DELETE RESTRICT,
  display_name       text NOT NULL,
  legal_name         text,
  partner_code       text NOT NULL,
  description_ar     text,
  onboarding_status  text NOT NULL DEFAULT 'DRAFT',
  operational_status text NOT NULL DEFAULT 'PENDING',
  logo_asset_id      uuid,
  cover_asset_id     uuid,
  cuisine_tags       jsonb NOT NULL DEFAULT '[]'::jsonb,
  rating_average     double precision,
  rating_count       integer NOT NULL DEFAULT 0,
  minimum_order_iqd  bigint NOT NULL DEFAULT 0,
  menu_version       integer NOT NULL DEFAULT 1,
  approved_at        timestamptz,
  approved_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  suspended_at       timestamptz,
  suspended_reason   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  CONSTRAINT restaurants_onboarding_check CHECK (onboarding_status IN
    ('DRAFT','UNDER_REVIEW','INFO_REQUESTED','APPROVED','REJECTED')),
  CONSTRAINT restaurants_operational_check CHECK (operational_status IN
    ('PENDING','ACTIVE','PAUSED','SUSPENDED')),
  CONSTRAINT restaurants_minimum_order_non_negative CHECK (minimum_order_iqd >= 0),
  CONSTRAINT restaurants_rating_range CHECK (rating_average IS NULL OR rating_average BETWEEN 0 AND 5),
  -- A restaurant cannot be operationally ACTIVE without approval (plan §18).
  CONSTRAINT restaurants_active_requires_approval CHECK (
    operational_status <> 'ACTIVE' OR onboarding_status = 'APPROVED'
  )
);
CREATE UNIQUE INDEX restaurants_partner_code_key ON restaurants (partner_code);
CREATE INDEX restaurants_status_idx ON restaurants (onboarding_status, operational_status);
CREATE INDEX restaurants_provider_idx ON restaurants (provider_id);
CREATE INDEX restaurants_name_trgm_idx ON restaurants USING gin (display_name gin_trgm_ops);

CREATE TABLE restaurant_branches (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id            uuid NOT NULL REFERENCES restaurants (id) ON DELETE RESTRICT,
  name                     text NOT NULL,
  governorate_id           uuid NOT NULL REFERENCES governorates (id) ON DELETE RESTRICT,
  city_id                  uuid NOT NULL REFERENCES cities (id) ON DELETE RESTRICT,
  address_text             text NOT NULL,
  district_text            text,
  latitude                 double precision,
  longitude                double precision,
  phone                    text,
  is_active                boolean NOT NULL DEFAULT false,
  accepts_orders           boolean NOT NULL DEFAULT false,
  busy_mode                text NOT NULL DEFAULT 'NORMAL',
  busy_mode_expires_at     timestamptz,
  base_preparation_minutes integer NOT NULL DEFAULT 30,
  delivery_fee_iqd         bigint NOT NULL DEFAULT 0,
  service_radius_meters    integer,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  deleted_at               timestamptz,
  CONSTRAINT branches_busy_mode_check CHECK (busy_mode IN ('NORMAL','BUSY','VERY_BUSY','PAUSED')),
  CONSTRAINT branches_delivery_fee_non_negative CHECK (delivery_fee_iqd >= 0),
  CONSTRAINT branches_prep_minutes_sane CHECK (base_preparation_minutes BETWEEN 0 AND 600),
  CONSTRAINT branches_lat_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CONSTRAINT branches_lng_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);
CREATE INDEX restaurant_branches_city_active_idx ON restaurant_branches (city_id, is_active);
CREATE INDEX restaurant_branches_restaurant_idx ON restaurant_branches (restaurant_id);

CREATE TABLE branch_working_hours (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id        uuid NOT NULL REFERENCES restaurant_branches (id) ON DELETE CASCADE,
  day_of_week      integer NOT NULL,
  opens_at_minute  integer NOT NULL,
  closes_at_minute integer NOT NULL,
  is_closed        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT working_hours_day_range CHECK (day_of_week BETWEEN 0 AND 6),
  -- Minute-of-day. 1440 is permitted as an exclusive "midnight" close.
  CONSTRAINT working_hours_open_range CHECK (opens_at_minute BETWEEN 0 AND 1440),
  CONSTRAINT working_hours_close_range CHECK (closes_at_minute BETWEEN 0 AND 1440)
);
CREATE INDEX branch_working_hours_branch_idx ON branch_working_hours (branch_id, day_of_week);

CREATE TABLE branch_hour_exceptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id        uuid NOT NULL REFERENCES restaurant_branches (id) ON DELETE CASCADE,
  local_date       text NOT NULL,
  is_closed        boolean NOT NULL DEFAULT true,
  opens_at_minute  integer,
  closes_at_minute integer,
  note_ar          text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hour_exceptions_date_format CHECK (local_date ~ '^\d{4}-\d{2}-\d{2}$')
);
CREATE UNIQUE INDEX branch_hour_exceptions_unique ON branch_hour_exceptions (branch_id, local_date);

CREATE TABLE restaurant_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role            text NOT NULL,
  branch_id       uuid REFERENCES restaurant_branches (id) ON DELETE CASCADE,
  is_active       boolean NOT NULL DEFAULT true,
  invited_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deactivated_at  timestamptz,
  CONSTRAINT restaurant_members_role_check CHECK (role IN
    ('OWNER','MANAGER','CASHIER','KITCHEN','INVENTORY_MANAGER','ACCOUNTANT'))
);
CREATE UNIQUE INDEX restaurant_members_unique ON restaurant_members (restaurant_id, user_id, role);
CREATE INDEX restaurant_members_user_idx ON restaurant_members (user_id, restaurant_id);

CREATE TABLE restaurant_applications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       uuid REFERENCES restaurants (id) ON DELETE SET NULL,
  applicant_user_id   uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  display_name        text NOT NULL,
  contact_phone_e164  text NOT NULL,
  governorate_id      uuid NOT NULL REFERENCES governorates (id) ON DELETE RESTRICT,
  city_id             uuid NOT NULL REFERENCES cities (id) ON DELETE RESTRICT,
  address_text        text NOT NULL,
  latitude            double precision,
  longitude           double precision,
  cuisine_tags        jsonb NOT NULL DEFAULT '[]'::jsonb,
  documents_json      jsonb,
  status              text NOT NULL DEFAULT 'UNDER_REVIEW',
  reviewed_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at         timestamptz,
  review_note         text,
  rejection_reason    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT applications_status_check CHECK (status IN
    ('DRAFT','UNDER_REVIEW','INFO_REQUESTED','APPROVED','REJECTED'))
);
CREATE INDEX restaurant_applications_status_idx ON restaurant_applications (status, created_at DESC);
CREATE INDEX restaurant_applications_city_idx ON restaurant_applications (city_id);

CREATE TABLE branch_location_change_requests (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id                 uuid NOT NULL REFERENCES restaurant_branches (id) ON DELETE CASCADE,
  requested_by              uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  current_governorate_id    uuid NOT NULL,
  current_city_id           uuid NOT NULL,
  requested_governorate_id  uuid NOT NULL REFERENCES governorates (id) ON DELETE RESTRICT,
  requested_city_id         uuid NOT NULL REFERENCES cities (id) ON DELETE RESTRICT,
  requested_address_text    text NOT NULL,
  requested_latitude        double precision,
  requested_longitude       double precision,
  status                    text NOT NULL DEFAULT 'PENDING',
  decided_by                uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at                timestamptz,
  effective_at              timestamptz,
  decision_note             text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT location_change_status_check CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED'))
);
CREATE INDEX branch_location_changes_branch_idx ON branch_location_change_requests (branch_id, status);

-- =============================================================================
-- CATALOG (plan §19, §20)
-- =============================================================================

CREATE TABLE menu_categories (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  name_ar        text NOT NULL,
  description_ar text,
  sort_order     integer NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz
);
CREATE INDEX menu_categories_restaurant_idx ON menu_categories (restaurant_id, sort_order);

CREATE TABLE menu_items (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id                 uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  category_id                   uuid NOT NULL REFERENCES menu_categories (id) ON DELETE RESTRICT,
  name_ar                       text NOT NULL,
  description_ar                text,
  base_price_iqd                bigint NOT NULL,
  cost_price_iqd                bigint,
  image_asset_id                uuid,
  sku                           text,
  is_active                     boolean NOT NULL DEFAULT true,
  is_available                  boolean NOT NULL DEFAULT true,
  unavailable_by_inventory      boolean NOT NULL DEFAULT false,
  preparation_minutes_override  integer,
  sort_order                    integer NOT NULL DEFAULT 0,
  is_popular                    boolean NOT NULL DEFAULT false,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  deleted_at                    timestamptz,
  CONSTRAINT menu_items_price_non_negative CHECK (base_price_iqd >= 0),
  CONSTRAINT menu_items_cost_non_negative CHECK (cost_price_iqd IS NULL OR cost_price_iqd >= 0)
);
CREATE INDEX menu_items_restaurant_idx ON menu_items (restaurant_id, is_active);
CREATE INDEX menu_items_category_idx ON menu_items (category_id, sort_order);
CREATE UNIQUE INDEX menu_items_sku_key ON menu_items (restaurant_id, sku) WHERE sku IS NOT NULL;
CREATE INDEX menu_items_name_trgm_idx ON menu_items USING gin (name_ar gin_trgm_ops);

CREATE TABLE modifier_groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  name_ar       text NOT NULL,
  min_select    integer NOT NULL DEFAULT 0,
  max_select    integer NOT NULL DEFAULT 1,
  is_required   boolean NOT NULL DEFAULT false,
  sort_order    integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT modifier_groups_select_range CHECK (min_select >= 0 AND max_select >= min_select),
  -- A required group must permit at least one selection.
  CONSTRAINT modifier_groups_required_consistent CHECK (NOT is_required OR min_select >= 1)
);
CREATE INDEX modifier_groups_restaurant_idx ON modifier_groups (restaurant_id);

CREATE TABLE modifiers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     uuid NOT NULL REFERENCES modifier_groups (id) ON DELETE CASCADE,
  name_ar      text NOT NULL,
  price_iqd    bigint NOT NULL DEFAULT 0,
  is_available boolean NOT NULL DEFAULT true,
  sort_order   integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT modifiers_price_non_negative CHECK (price_iqd >= 0)
);
CREATE INDEX modifiers_group_idx ON modifiers (group_id, sort_order);

CREATE TABLE item_modifier_groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    uuid NOT NULL REFERENCES menu_items (id) ON DELETE CASCADE,
  group_id   uuid NOT NULL REFERENCES modifier_groups (id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX item_modifier_groups_unique ON item_modifier_groups (item_id, group_id);

CREATE TABLE branch_item_availability (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    uuid NOT NULL REFERENCES restaurant_branches (id) ON DELETE CASCADE,
  item_id      uuid NOT NULL REFERENCES menu_items (id) ON DELETE CASCADE,
  is_available boolean NOT NULL DEFAULT true,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX branch_item_availability_unique ON branch_item_availability (branch_id, item_id);

-- =============================================================================
-- ORDERS (plan §25–§28)
-- =============================================================================

CREATE TABLE orders (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_order_number               text NOT NULL,
  user_id                           uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  restaurant_id                     uuid NOT NULL REFERENCES restaurants (id) ON DELETE RESTRICT,
  branch_id                         uuid NOT NULL REFERENCES restaurant_branches (id) ON DELETE RESTRICT,
  address_id                        uuid REFERENCES user_addresses (id) ON DELETE SET NULL,
  status                            text NOT NULL DEFAULT 'PLACED',
  payment_method                    text NOT NULL DEFAULT 'CASH_ON_DELIVERY',
  payment_status                    text NOT NULL DEFAULT 'CASH_EXPECTED',
  currency                          text NOT NULL DEFAULT 'IQD',

  items_subtotal_iqd                bigint NOT NULL,
  delivery_fee_iqd                  bigint NOT NULL DEFAULT 0,
  platform_service_fee_iqd          bigint NOT NULL DEFAULT 0,
  discount_total_iqd                bigint NOT NULL DEFAULT 0,
  restaurant_funded_discount_iqd    bigint NOT NULL DEFAULT 0,
  platform_funded_discount_iqd      bigint NOT NULL DEFAULT 0,
  customer_total_iqd                bigint NOT NULL,

  commission_base_iqd               bigint NOT NULL,
  commission_rate_bps_snapshot      integer NOT NULL,
  commission_amount_iqd             bigint NOT NULL,
  restaurant_net_snapshot_iqd       bigint NOT NULL,

  customer_name_snapshot            text NOT NULL,
  customer_phone_snapshot           text NOT NULL,
  delivery_address_snapshot_json    jsonb NOT NULL,
  restaurant_location_snapshot_json jsonb NOT NULL,
  customer_notes                    text,

  delivery_pin_hash                 text,
  delivery_pin_attempts             integer NOT NULL DEFAULT 0,
  estimated_preparation_minutes     integer,

  placed_at                         timestamptz NOT NULL DEFAULT now(),
  accepted_at                       timestamptz,
  ready_at                          timestamptz,
  out_for_delivery_at               timestamptz,
  delivered_at                      timestamptz,
  completed_at                      timestamptz,
  cancelled_at                      timestamptz,
  cancellation_reason               text,
  rejection_reason                  text,

  version                           bigint NOT NULL DEFAULT 0,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT orders_status_check CHECK (status IN
    ('PLACED','PENDING_RESTAURANT','ACCEPTED','PREPARING','READY',
     'OUT_FOR_DELIVERY','DELIVERED','COMPLETED','REJECTED','CANCELLED')),
  CONSTRAINT orders_payment_status_check CHECK (payment_status IN
    ('UNPAID','CASH_EXPECTED','PAID_CASH','FAILED','REFUNDED_FUTURE')),
  CONSTRAINT orders_payment_method_check CHECK (payment_method IN ('CASH_ON_DELIVERY')),
  -- Plan §99: commission basis points 0–10000.
  CONSTRAINT orders_commission_bps_range CHECK (commission_rate_bps_snapshot BETWEEN 0 AND 10000),
  CONSTRAINT orders_amounts_non_negative CHECK (
    items_subtotal_iqd >= 0 AND delivery_fee_iqd >= 0 AND platform_service_fee_iqd >= 0
    AND discount_total_iqd >= 0 AND customer_total_iqd >= 0
    AND commission_base_iqd >= 0 AND commission_amount_iqd >= 0
  ),
  -- The customer total must reconcile with its components (plan §95).
  CONSTRAINT orders_total_reconciles CHECK (
    customer_total_iqd =
      items_subtotal_iqd - discount_total_iqd + delivery_fee_iqd + platform_service_fee_iqd
  ),
  CONSTRAINT orders_discount_split_reconciles CHECK (
    discount_total_iqd = restaurant_funded_discount_iqd + platform_funded_discount_iqd
  ),
  -- Commission may never exceed the base it was computed from.
  CONSTRAINT orders_commission_within_base CHECK (commission_amount_iqd <= commission_base_iqd),
  CONSTRAINT orders_pin_attempts_non_negative CHECK (delivery_pin_attempts >= 0)
);
CREATE UNIQUE INDEX orders_public_number_key ON orders (public_order_number);
CREATE INDEX orders_restaurant_status_idx ON orders (restaurant_id, status, created_at DESC);
CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC);
CREATE INDEX orders_branch_completed_idx ON orders (branch_id, completed_at);
CREATE INDEX orders_status_idx ON orders (status, placed_at);
-- Live board query (plan §29): only open orders, so the index stays small.
CREATE INDEX orders_live_board_idx ON orders (branch_id, status, placed_at)
  WHERE status IN ('PENDING_RESTAURANT','ACCEPTED','PREPARING','READY','OUT_FOR_DELIVERY');

CREATE TABLE order_items (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  menu_item_id            uuid REFERENCES menu_items (id) ON DELETE SET NULL,
  name_ar_snapshot        text NOT NULL,
  unit_price_iqd_snapshot bigint NOT NULL,
  cost_price_iqd_snapshot bigint,
  quantity                integer NOT NULL,
  line_total_iqd          bigint NOT NULL,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  -- Plan §99: positive order-item quantity.
  CONSTRAINT order_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT order_items_amounts_non_negative CHECK (unit_price_iqd_snapshot >= 0 AND line_total_iqd >= 0)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

CREATE TABLE order_item_modifiers (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id          uuid NOT NULL REFERENCES order_items (id) ON DELETE CASCADE,
  modifier_id            uuid REFERENCES modifiers (id) ON DELETE SET NULL,
  group_name_ar_snapshot text NOT NULL,
  name_ar_snapshot       text NOT NULL,
  price_iqd_snapshot     bigint NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_item_modifiers_price_non_negative CHECK (price_iqd_snapshot >= 0)
);
CREATE INDEX order_item_modifiers_item_idx ON order_item_modifiers (order_item_id);

CREATE TABLE order_status_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  from_status   text,
  to_status     text NOT NULL,
  actor_type    text NOT NULL,
  actor_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  reason        text,
  metadata_json jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_status_history_actor_check CHECK (actor_type IN
    ('CUSTOMER','RESTAURANT','DRIVER','ADMIN','SYSTEM'))
);
CREATE INDEX order_status_history_order_idx ON order_status_history (order_id, created_at);

CREATE TABLE idempotency_keys (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key              text NOT NULL,
  scope            text NOT NULL,
  user_id          uuid REFERENCES users (id) ON DELETE CASCADE,
  request_hash     text NOT NULL,
  response_json    jsonb,
  result_entity_id text,
  status           text NOT NULL DEFAULT 'IN_PROGRESS',
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_status_check CHECK (status IN ('IN_PROGRESS','COMPLETED','FAILED'))
);
-- Plan §99: unique idempotency keys in the relevant scope.
CREATE UNIQUE INDEX idempotency_keys_scope_key ON idempotency_keys (scope, key);
CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys (expires_at);

CREATE TABLE carts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  restaurant_id     uuid REFERENCES restaurants (id) ON DELETE CASCADE,
  branch_id         uuid REFERENCES restaurant_branches (id) ON DELETE CASCADE,
  menu_version_seen integer,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- One restaurant per cart in Release 1 (plan §21) — enforced by one cart per user.
CREATE UNIQUE INDEX carts_user_key ON carts (user_id);

CREATE TABLE cart_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id      uuid NOT NULL REFERENCES carts (id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES menu_items (id) ON DELETE CASCADE,
  quantity     integer NOT NULL DEFAULT 1,
  modifier_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cart_items_quantity_positive CHECK (quantity > 0 AND quantity <= 99)
);
CREATE INDEX cart_items_cart_idx ON cart_items (cart_id);

CREATE TABLE order_reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  rating        integer NOT NULL,
  comment       text,
  is_hidden     boolean NOT NULL DEFAULT false,
  moderated_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_reviews_rating_range CHECK (rating BETWEEN 1 AND 5)
);
-- Plan §57: one review per order.
CREATE UNIQUE INDEX order_reviews_order_key ON order_reviews (order_id);
CREATE INDEX order_reviews_restaurant_idx ON order_reviews (restaurant_id, created_at DESC);

CREATE TABLE customer_favorites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX customer_favorites_unique ON customer_favorites (user_id, restaurant_id);

-- =============================================================================
-- DELIVERY (plan §45–§54)
-- =============================================================================

CREATE TABLE drivers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status               text NOT NULL DEFAULT 'PENDING_ACTIVATION',
  availability         text NOT NULL DEFAULT 'OFFLINE',
  default_vehicle_type text NOT NULL DEFAULT 'MOTORCYCLE',
  plate_number         text,
  photo_asset_id       uuid,
  last_heartbeat_at    timestamptz,
  activated_at         timestamptz,
  suspended_at         timestamptz,
  suspended_reason     text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT drivers_status_check CHECK (status IN
    ('PENDING_ACTIVATION','ACTIVE','SUSPENDED','DEACTIVATED')),
  CONSTRAINT drivers_availability_check CHECK (availability IN
    ('OFFLINE','AVAILABLE','BUSY','ON_DELIVERY','BREAK')),
  CONSTRAINT drivers_vehicle_check CHECK (default_vehicle_type IN
    ('MOTORCYCLE','CAR','BICYCLE','ON_FOOT'))
);
CREATE UNIQUE INDEX drivers_user_key ON drivers (user_id);
CREATE INDEX drivers_status_idx ON drivers (status, availability);

CREATE TABLE restaurant_drivers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  branch_id        uuid REFERENCES restaurant_branches (id) ON DELETE SET NULL,
  driver_id        uuid NOT NULL REFERENCES drivers (id) ON DELETE CASCADE,
  can_collect_cash boolean NOT NULL DEFAULT true,
  is_active        boolean NOT NULL DEFAULT true,
  internal_note    text,
  created_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deactivated_at   timestamptz
);
CREATE UNIQUE INDEX restaurant_drivers_unique ON restaurant_drivers (restaurant_id, driver_id);
CREATE INDEX restaurant_drivers_restaurant_idx ON restaurant_drivers (restaurant_id, is_active);

CREATE TABLE delivery_assignments (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                  uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  restaurant_id             uuid NOT NULL REFERENCES restaurants (id) ON DELETE RESTRICT,
  branch_id                 uuid NOT NULL REFERENCES restaurant_branches (id) ON DELETE RESTRICT,
  driver_id                 uuid NOT NULL REFERENCES drivers (id) ON DELETE RESTRICT,
  status                    text NOT NULL DEFAULT 'ASSIGNED',
  assigned_by               uuid REFERENCES users (id) ON DELETE SET NULL,
  assigned_at               timestamptz NOT NULL DEFAULT now(),
  accepted_at               timestamptz,
  picked_up_at              timestamptz,
  arrived_customer_at       timestamptz,
  delivered_at              timestamptz,
  cancelled_at              timestamptz,
  rejection_reason          text,
  cancellation_reason       text,
  replaced_by_assignment_id uuid,
  version                   bigint NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_status_check CHECK (status IN
    ('ASSIGNED','ACCEPTED','REJECTED','PICKED_UP','ARRIVED_CUSTOMER','DELIVERED','CANCELLED','REASSIGNED'))
);
CREATE INDEX delivery_assignments_driver_idx ON delivery_assignments (driver_id, status, created_at DESC);
CREATE INDEX delivery_assignments_order_idx ON delivery_assignments (order_id);
CREATE INDEX delivery_assignments_restaurant_idx ON delivery_assignments (restaurant_id, status);
-- Plan §48: one active delivery per driver by default. This partial unique index
-- is what makes the assignment race unwinnable rather than merely unlikely.
CREATE UNIQUE INDEX delivery_assignments_one_active_per_driver
  ON delivery_assignments (driver_id)
  WHERE status IN ('ASSIGNED','ACCEPTED','PICKED_UP','ARRIVED_CUSTOMER');
-- An order can only have one live assignment at a time.
CREATE UNIQUE INDEX delivery_assignments_one_active_per_order
  ON delivery_assignments (order_id)
  WHERE status IN ('ASSIGNED','ACCEPTED','PICKED_UP','ARRIVED_CUSTOMER');

CREATE TABLE driver_cash_handovers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id           uuid NOT NULL REFERENCES drivers (id) ON DELETE RESTRICT,
  restaurant_id       uuid NOT NULL REFERENCES restaurants (id) ON DELETE RESTRICT,
  amount_iqd          bigint NOT NULL,
  received_by_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  reference           text,
  note                text,
  confirmed_at        timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT handover_amount_positive CHECK (amount_iqd > 0)
);
CREATE INDEX driver_cash_handovers_driver_idx ON driver_cash_handovers (driver_id, created_at DESC);

CREATE TABLE driver_cash_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id       uuid NOT NULL REFERENCES drivers (id) ON DELETE RESTRICT,
  restaurant_id   uuid NOT NULL REFERENCES restaurants (id) ON DELETE RESTRICT,
  type            text NOT NULL,
  amount_iqd      bigint NOT NULL,
  order_id        uuid REFERENCES orders (id) ON DELETE SET NULL,
  handover_id     uuid REFERENCES driver_cash_handovers (id) ON DELETE SET NULL,
  note            text,
  actor_user_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_cash_type_check CHECK (type IN
    ('ORDER_CASH_COLLECTED','CASH_HANDED_OVER','CASH_ADJUSTMENT')),
  -- Collections add, handovers subtract. Signs must match the event type so a
  -- custody balance can never be corrupted by a mis-signed row (plan §96).
  CONSTRAINT driver_cash_sign_matches_type CHECK (
    (type = 'ORDER_CASH_COLLECTED' AND amount_iqd > 0)
    OR (type = 'CASH_HANDED_OVER' AND amount_iqd < 0)
    OR (type = 'CASH_ADJUSTMENT')
  ),
  -- Cash collected must always name the order it came from.
  CONSTRAINT driver_cash_collected_has_order CHECK (
    type <> 'ORDER_CASH_COLLECTED' OR order_id IS NOT NULL
  )
);
CREATE INDEX driver_cash_events_driver_idx ON driver_cash_events (driver_id, created_at DESC);
CREATE INDEX driver_cash_events_restaurant_idx ON driver_cash_events (restaurant_id, created_at DESC);
CREATE UNIQUE INDEX driver_cash_events_idempotency_key
  ON driver_cash_events (idempotency_key) WHERE idempotency_key IS NOT NULL;
-- One collection event per order: a retried delivery cannot double-credit custody.
CREATE UNIQUE INDEX driver_cash_events_one_collection_per_order
  ON driver_cash_events (order_id) WHERE type = 'ORDER_CASH_COLLECTED';

CREATE TABLE delivery_pin_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  driver_id      uuid NOT NULL REFERENCES drivers (id) ON DELETE CASCADE,
  succeeded      boolean NOT NULL,
  attempt_number integer NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_pin_attempts_order_idx ON delivery_pin_attempts (order_id, created_at DESC);

-- =============================================================================
-- INVENTORY (plan §34–§37)
-- =============================================================================

CREATE TABLE inventory_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id        uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  branch_id            uuid NOT NULL REFERENCES restaurant_branches (id) ON DELETE CASCADE,
  name_ar              text NOT NULL,
  sku                  text,
  unit                 text NOT NULL DEFAULT 'PIECE',
  on_hand_quantity     numeric(14,3) NOT NULL DEFAULT 0,
  reserved_quantity    numeric(14,3) NOT NULL DEFAULT 0,
  low_stock_threshold  numeric(14,3),
  unit_cost_iqd        bigint,
  is_tracked           boolean NOT NULL DEFAULT true,
  allow_negative_stock boolean NOT NULL DEFAULT false,
  low_stock_notified_at timestamptz,
  version              bigint NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  deleted_at           timestamptz,
  CONSTRAINT inventory_unit_check CHECK (unit IN ('PIECE','GRAM','KILOGRAM','MILLILITER','LITER')),
  CONSTRAINT inventory_reserved_non_negative CHECK (reserved_quantity >= 0),
  CONSTRAINT inventory_cost_non_negative CHECK (unit_cost_iqd IS NULL OR unit_cost_iqd >= 0),
  -- Stock may only go negative where the restaurant explicitly allows it (plan §34).
  CONSTRAINT inventory_negative_stock_policy CHECK (allow_negative_stock OR on_hand_quantity >= 0)
);
CREATE INDEX inventory_items_branch_idx ON inventory_items (branch_id, is_tracked);
CREATE UNIQUE INDEX inventory_items_sku_key ON inventory_items (branch_id, sku) WHERE sku IS NOT NULL;

CREATE TABLE inventory_movements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id uuid NOT NULL REFERENCES inventory_items (id) ON DELETE RESTRICT,
  type              text NOT NULL,
  quantity_delta    numeric(14,3) NOT NULL,
  resulting_on_hand numeric(14,3) NOT NULL,
  unit_cost_iqd     bigint,
  order_id          uuid REFERENCES orders (id) ON DELETE SET NULL,
  reason            text,
  actor_user_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  idempotency_key   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_movement_type_check CHECK (type IN
    ('OPENING_BALANCE','PURCHASE','RESERVATION','RESERVATION_RELEASE',
     'SALE_CONSUMPTION','ADJUSTMENT','WASTE','RETURN')),
  -- Manual adjustments and waste always carry a reason (plan §35).
  CONSTRAINT inventory_manual_movements_have_reason CHECK (
    type NOT IN ('ADJUSTMENT','WASTE') OR (reason IS NOT NULL AND btrim(reason) <> '')
  )
);
CREATE INDEX inventory_movements_item_idx ON inventory_movements (inventory_item_id, created_at DESC);
CREATE INDEX inventory_movements_order_idx ON inventory_movements (order_id);
CREATE UNIQUE INDEX inventory_movements_idempotency_key
  ON inventory_movements (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE inventory_reservations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_id uuid NOT NULL REFERENCES inventory_items (id) ON DELETE CASCADE,
  order_id          uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  quantity_reserved numeric(14,3) NOT NULL,
  status            text NOT NULL DEFAULT 'ACTIVE',
  released_at       timestamptz,
  consumed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservation_status_check CHECK (status IN ('ACTIVE','RELEASED','CONSUMED')),
  CONSTRAINT reservation_quantity_positive CHECK (quantity_reserved > 0)
);
-- Plan §183: duplicate consumption protection.
CREATE UNIQUE INDEX inventory_reservations_unique ON inventory_reservations (order_id, inventory_item_id);
CREATE INDEX inventory_reservations_status_idx ON inventory_reservations (status, created_at);

CREATE TABLE recipes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id      uuid NOT NULL REFERENCES menu_items (id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items (id) ON DELETE RESTRICT,
  quantity_per_unit numeric(14,3) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recipes_quantity_positive CHECK (quantity_per_unit > 0)
);
CREATE UNIQUE INDEX recipes_unique ON recipes (menu_item_id, inventory_item_id);

CREATE TABLE stocktakes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id    uuid NOT NULL REFERENCES restaurant_branches (id) ON DELETE CASCADE,
  performed_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  note         text,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stocktakes_branch_idx ON stocktakes (branch_id, created_at DESC);

CREATE TABLE stocktake_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stocktake_id      uuid NOT NULL REFERENCES stocktakes (id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items (id) ON DELETE RESTRICT,
  expected_quantity numeric(14,3) NOT NULL,
  counted_quantity  numeric(14,3) NOT NULL,
  variance_quantity numeric(14,3) NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stocktake_variance_consistent CHECK (
    variance_quantity = counted_quantity - expected_quantity
  )
);
CREATE INDEX stocktake_lines_stocktake_idx ON stocktake_lines (stocktake_id);

-- =============================================================================
-- FINANCE (plan §24, §39–§44)
-- =============================================================================

CREATE TABLE restaurant_commission_configs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  commission_rate_bps integer NOT NULL,
  settlement_policy   text NOT NULL DEFAULT 'HALF_MONTH',
  payment_term_days   integer NOT NULL DEFAULT 7,
  effective_from      timestamptz NOT NULL,
  effective_to        timestamptz,
  created_by          uuid REFERENCES users (id) ON DELETE SET NULL,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Plan §99: commission basis points 0–10000.
  CONSTRAINT commission_bps_range CHECK (commission_rate_bps BETWEEN 0 AND 10000),
  CONSTRAINT commission_policy_check CHECK (settlement_policy IN ('HALF_MONTH','MONTHLY')),
  CONSTRAINT commission_period_ordered CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT commission_term_days_sane CHECK (payment_term_days BETWEEN 0 AND 90)
);
CREATE INDEX commission_configs_restaurant_idx ON restaurant_commission_configs (restaurant_id, effective_from DESC);
-- Only one open-ended (current) commission config per restaurant.
CREATE UNIQUE INDEX commission_configs_one_current
  ON restaurant_commission_configs (restaurant_id) WHERE effective_to IS NULL;

CREATE TABLE settlements (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id            uuid NOT NULL REFERENCES restaurants (id) ON DELETE RESTRICT,
  settlement_policy        text NOT NULL,
  period_start             timestamptz NOT NULL,
  period_end               timestamptz NOT NULL,
  status                   text NOT NULL DEFAULT 'DRAFT',
  order_count              integer NOT NULL DEFAULT 0,
  gross_sales_iqd          bigint NOT NULL DEFAULT 0,
  commission_base_total_iqd bigint NOT NULL DEFAULT 0,
  commission_total_iqd     bigint NOT NULL DEFAULT 0,
  adjustments_total_iqd    bigint NOT NULL DEFAULT 0,
  amount_due_iqd           bigint NOT NULL DEFAULT 0,
  amount_paid_iqd          bigint NOT NULL DEFAULT 0,
  due_date                 timestamptz,
  issued_at                timestamptz,
  issued_by                uuid REFERENCES users (id) ON DELETE SET NULL,
  paid_at                  timestamptz,
  voided_at                timestamptz,
  voided_by                uuid REFERENCES users (id) ON DELETE SET NULL,
  void_reason              text,
  dispute_reason           text,
  disputed_at              timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlements_status_check CHECK (status IN
    ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','OVERDUE','DISPUTED','VOID')),
  -- Half-open period [start, end) — plan §40.
  CONSTRAINT settlements_period_ordered CHECK (period_end > period_start),
  CONSTRAINT settlements_amounts_non_negative CHECK (
    order_count >= 0 AND gross_sales_iqd >= 0 AND commission_total_iqd >= 0 AND amount_paid_iqd >= 0
  ),
  -- Plan §95: amount due must equal commission plus approved adjustments.
  CONSTRAINT settlements_due_reconciles CHECK (
    amount_due_iqd = commission_total_iqd + adjustments_total_iqd
  ),
  -- A statement cannot be over-paid (plan §76 PAYMENT_EXCEEDS_ALLOWED_BALANCE).
  CONSTRAINT settlements_not_overpaid CHECK (amount_paid_iqd <= amount_due_iqd),
  -- Voiding always records why and by whom (plan §44).
  CONSTRAINT settlements_void_has_reason CHECK (
    status <> 'VOID' OR (void_reason IS NOT NULL AND voided_at IS NOT NULL)
  )
);
-- Plan §99: unique settlement per restaurant/period. This is what makes a
-- retried generation job safe.
CREATE UNIQUE INDEX settlements_restaurant_period_key
  ON settlements (restaurant_id, period_start, period_end);
CREATE INDEX settlements_restaurant_idx ON settlements (restaurant_id, period_start DESC);
CREATE INDEX settlements_status_idx ON settlements (status, due_date);

CREATE TABLE settlement_lines (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id                uuid NOT NULL REFERENCES settlements (id) ON DELETE CASCADE,
  order_id                     uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  commission_base_iqd          bigint NOT NULL,
  commission_rate_bps_snapshot integer NOT NULL,
  commission_amount_iqd        bigint NOT NULL,
  order_completed_at           timestamptz NOT NULL,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlement_lines_bps_range CHECK (commission_rate_bps_snapshot BETWEEN 0 AND 10000),
  CONSTRAINT settlement_lines_amounts_non_negative CHECK (
    commission_base_iqd >= 0 AND commission_amount_iqd >= 0
  )
);
-- Plan §225: a settlement cannot include the same order twice, across ALL
-- settlements — not merely within one.
CREATE UNIQUE INDEX settlement_lines_order_key ON settlement_lines (order_id);
CREATE INDEX settlement_lines_settlement_idx ON settlement_lines (settlement_id);

CREATE TABLE settlement_adjustments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id           uuid REFERENCES settlements (id) ON DELETE SET NULL,
  restaurant_id           uuid NOT NULL REFERENCES restaurants (id) ON DELETE RESTRICT,
  amount_iqd              bigint NOT NULL,
  reason                  text NOT NULL,
  approved_by             uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  reverses_adjustment_id  uuid REFERENCES settlement_adjustments (id) ON DELETE SET NULL,
  idempotency_key         text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT adjustment_reason_not_blank CHECK (btrim(reason) <> ''),
  CONSTRAINT adjustment_amount_non_zero CHECK (amount_iqd <> 0)
);
CREATE INDEX settlement_adjustments_settlement_idx ON settlement_adjustments (settlement_id);
CREATE INDEX settlement_adjustments_restaurant_idx ON settlement_adjustments (restaurant_id, created_at DESC);
CREATE UNIQUE INDEX settlement_adjustments_idempotency_key
  ON settlement_adjustments (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE settlement_payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id       uuid NOT NULL REFERENCES settlements (id) ON DELETE RESTRICT,
  restaurant_id       uuid NOT NULL REFERENCES restaurants (id) ON DELETE RESTRICT,
  amount_iqd          bigint NOT NULL,
  method              text NOT NULL,
  reference           text,
  receipt_asset_id    uuid,
  paid_at             timestamptz NOT NULL,
  recorded_by         uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  note                text,
  reverses_payment_id uuid REFERENCES settlement_payments (id) ON DELETE SET NULL,
  idempotency_key     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_method_check CHECK (method IN ('CASH','BANK_TRANSFER','CHEQUE','OTHER')),
  CONSTRAINT payment_amount_non_zero CHECK (amount_iqd <> 0)
);
CREATE INDEX settlement_payments_settlement_idx ON settlement_payments (settlement_id, paid_at DESC);
CREATE UNIQUE INDEX settlement_payments_idempotency_key
  ON settlement_payments (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE ledger_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   uuid NOT NULL REFERENCES restaurants (id) ON DELETE RESTRICT,
  order_id        uuid REFERENCES orders (id) ON DELETE SET NULL,
  settlement_id   uuid REFERENCES settlements (id) ON DELETE SET NULL,
  entry_type      text NOT NULL,
  amount_iqd      bigint NOT NULL,
  direction       text NOT NULL,
  effective_at    timestamptz NOT NULL,
  idempotency_key text NOT NULL,
  metadata_json   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_entry_type_check CHECK (entry_type IN
    ('COMMISSION_ACCRUED','COMMISSION_PAYMENT','COMMISSION_CREDIT',
     'COMMISSION_DEBIT','SERVICE_FEE_REVENUE','REVERSAL')),
  CONSTRAINT ledger_direction_check CHECK (direction IN ('DEBIT','CREDIT')),
  CONSTRAINT ledger_amount_non_negative CHECK (amount_iqd >= 0)
);
-- Plan §28: a retried transaction cannot double-accrue commission.
CREATE UNIQUE INDEX ledger_entries_idempotency_key ON ledger_entries (idempotency_key);
CREATE INDEX ledger_entries_restaurant_idx ON ledger_entries (restaurant_id, effective_at DESC);
CREATE INDEX ledger_entries_order_idx ON ledger_entries (order_id);

CREATE TABLE restaurant_expenses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id    uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  branch_id        uuid REFERENCES restaurant_branches (id) ON DELETE SET NULL,
  category         text NOT NULL,
  amount_iqd       bigint NOT NULL,
  description_ar   text,
  expense_date     text NOT NULL,
  receipt_asset_id uuid,
  created_by       uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT expense_category_check CHECK (category IN
    ('SALARIES','RENT','INGREDIENTS','UTILITIES','MARKETING','MAINTENANCE','DELIVERY','OTHER')),
  CONSTRAINT expense_amount_positive CHECK (amount_iqd > 0),
  CONSTRAINT expense_date_format CHECK (expense_date ~ '^\d{4}-\d{2}-\d{2}$')
);
CREATE INDEX restaurant_expenses_restaurant_idx ON restaurant_expenses (restaurant_id, expense_date DESC);
CREATE INDEX restaurant_expenses_category_idx ON restaurant_expenses (category);

CREATE TABLE reconciliation_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_name     text NOT NULL,
  business_date  text NOT NULL,
  passed         text NOT NULL,
  expected_value bigint,
  actual_value   bigint,
  variance_iqd   bigint,
  details_json   jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_date_format CHECK (business_date ~ '^\d{4}-\d{2}-\d{2}$')
);
CREATE UNIQUE INDEX reconciliation_runs_unique ON reconciliation_runs (check_name, business_date);
CREATE INDEX reconciliation_runs_date_idx ON reconciliation_runs (business_date DESC);

-- =============================================================================
-- PLATFORM PLUMBING (plan §31, §56, §60, §83, §117, §118)
-- =============================================================================

CREATE TABLE outbox_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type        text NOT NULL,
  aggregate_type    text NOT NULL,
  aggregate_id      text NOT NULL,
  aggregate_version integer NOT NULL DEFAULT 0,
  payload           jsonb NOT NULL,
  status            text NOT NULL DEFAULT 'PENDING',
  attempt_count     integer NOT NULL DEFAULT 0,
  last_error        text,
  next_attempt_at   timestamptz NOT NULL DEFAULT now(),
  published_at      timestamptz,
  request_id        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_status_check CHECK (status IN ('PENDING','PUBLISHING','PUBLISHED','FAILED'))
);
-- The poller's hot path: due work only, so the index stays small as history grows.
CREATE INDEX outbox_events_pending_idx ON outbox_events (next_attempt_at)
  WHERE status IN ('PENDING','PUBLISHING');
CREATE INDEX outbox_events_aggregate_idx ON outbox_events (aggregate_type, aggregate_id);

CREATE TABLE notification_deliveries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_event_id   uuid REFERENCES outbox_events (id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  channel           text NOT NULL,
  title_ar          text NOT NULL,
  body_ar           text NOT NULL,
  data_json         jsonb,
  status            text NOT NULL DEFAULT 'PENDING',
  sent_at           timestamptz,
  read_at           timestamptz,
  failure_reason    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_channel_check CHECK (channel IN ('PUSH','REALTIME','SMS','BROWSER'))
);
-- Plan §99: unique event/recipient/channel, so a worker retry cannot alert twice.
CREATE UNIQUE INDEX notification_deliveries_unique
  ON notification_deliveries (outbox_event_id, recipient_user_id, channel);
CREATE INDEX notification_deliveries_recipient_idx
  ON notification_deliveries (recipient_user_id, created_at DESC);

CREATE TABLE platform_config (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key            text NOT NULL,
  value          jsonb NOT NULL,
  description_ar text,
  is_sensitive   boolean NOT NULL DEFAULT false,
  updated_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX platform_config_key_key ON platform_config (key);

CREATE TABLE platform_config_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key            text NOT NULL,
  previous_value jsonb,
  new_value      jsonb NOT NULL,
  reason         text,
  changed_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_config_history_key_idx ON platform_config_history (key, created_at DESC);

CREATE TABLE feature_flags (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                text NOT NULL,
  is_enabled         boolean NOT NULL DEFAULT false,
  description_ar     text,
  scope_json         jsonb,
  rollout_percentage integer NOT NULL DEFAULT 0,
  updated_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_flags_rollout_range CHECK (rollout_percentage BETWEEN 0 AND 100)
);
CREATE UNIQUE INDEX feature_flags_key_key ON feature_flags (key);

CREATE TABLE coupons (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL,
  type                  text NOT NULL,
  value                 integer NOT NULL,
  max_discount_iqd      bigint,
  minimum_order_iqd     bigint NOT NULL DEFAULT 0,
  funding_source        text NOT NULL,
  restaurant_share_bps  integer,
  restaurant_id         uuid REFERENCES restaurants (id) ON DELETE CASCADE,
  city_ids              jsonb,
  total_usage_limit     integer,
  per_user_usage_limit  integer NOT NULL DEFAULT 1,
  usage_count           integer NOT NULL DEFAULT 0,
  starts_at             timestamptz NOT NULL,
  ends_at               timestamptz,
  is_active             boolean NOT NULL DEFAULT true,
  created_by            uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coupon_type_check CHECK (type IN ('PERCENTAGE','FIXED_AMOUNT')),
  CONSTRAINT coupon_funding_check CHECK (funding_source IN ('PLATFORM','RESTAURANT','SHARED')),
  CONSTRAINT coupon_value_positive CHECK (value > 0),
  -- A percentage coupon's value is basis points and cannot exceed 100%.
  CONSTRAINT coupon_percentage_range CHECK (type <> 'PERCENTAGE' OR value <= 10000),
  -- SHARED funding must say how the cost is split (plan §60).
  CONSTRAINT coupon_shared_needs_split CHECK (
    funding_source <> 'SHARED' OR (restaurant_share_bps BETWEEN 0 AND 10000)
  ),
  CONSTRAINT coupon_period_ordered CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE UNIQUE INDEX coupons_code_key ON coupons (code);
CREATE INDEX coupons_active_idx ON coupons (is_active, starts_at, ends_at);

CREATE TABLE coupon_redemptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id             uuid NOT NULL REFERENCES coupons (id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  order_id              uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  discount_applied_iqd  bigint NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT redemption_amount_positive CHECK (discount_applied_iqd > 0)
);
-- One coupon per order; a retried checkout cannot redeem twice (plan §28).
CREATE UNIQUE INDEX coupon_redemptions_order_key ON coupon_redemptions (order_id);
CREATE INDEX coupon_redemptions_user_idx ON coupon_redemptions (coupon_id, user_id);

CREATE TABLE assets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key    text NOT NULL,
  bucket         text NOT NULL,
  visibility     text NOT NULL DEFAULT 'PRIVATE',
  content_type   text NOT NULL,
  byte_size      integer NOT NULL,
  width          integer,
  height         integer,
  variants_json  jsonb,
  owner_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  restaurant_id  uuid REFERENCES restaurants (id) ON DELETE CASCADE,
  scan_status    text NOT NULL DEFAULT 'PENDING',
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  CONSTRAINT assets_visibility_check CHECK (visibility IN ('PUBLIC','PRIVATE')),
  CONSTRAINT assets_scan_status_check CHECK (scan_status IN ('PENDING','CLEAN','INFECTED','SKIPPED')),
  CONSTRAINT assets_size_positive CHECK (byte_size > 0)
);
CREATE UNIQUE INDEX assets_storage_key_key ON assets (storage_key);
CREATE INDEX assets_restaurant_idx ON assets (restaurant_id);

CREATE TABLE job_locks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lock_key    text NOT NULL,
  owner_token text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
-- Plan §94: stops two workers generating the same settlement.
CREATE UNIQUE INDEX job_locks_key_key ON job_locks (lock_key);

-- =============================================================================
-- DEFERRED FOREIGN KEYS
-- Added after both sides exist.
-- =============================================================================

ALTER TABLE restaurants
  ADD CONSTRAINT restaurants_logo_asset_fk FOREIGN KEY (logo_asset_id) REFERENCES assets (id) ON DELETE SET NULL,
  ADD CONSTRAINT restaurants_cover_asset_fk FOREIGN KEY (cover_asset_id) REFERENCES assets (id) ON DELETE SET NULL;

ALTER TABLE menu_items
  ADD CONSTRAINT menu_items_image_asset_fk FOREIGN KEY (image_asset_id) REFERENCES assets (id) ON DELETE SET NULL;

ALTER TABLE drivers
  ADD CONSTRAINT drivers_photo_asset_fk FOREIGN KEY (photo_asset_id) REFERENCES assets (id) ON DELETE SET NULL;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_superseded_fk FOREIGN KEY (superseded_by_session_id) REFERENCES sessions (id) ON DELETE SET NULL;

ALTER TABLE delivery_assignments
  ADD CONSTRAINT delivery_assignments_replaced_by_fk FOREIGN KEY (replaced_by_assignment_id)
  REFERENCES delivery_assignments (id) ON DELETE SET NULL;

ALTER TABLE settlement_payments
  ADD CONSTRAINT settlement_payments_receipt_asset_fk FOREIGN KEY (receipt_asset_id)
  REFERENCES assets (id) ON DELETE SET NULL;

ALTER TABLE restaurant_expenses
  ADD CONSTRAINT restaurant_expenses_receipt_asset_fk FOREIGN KEY (receipt_asset_id)
  REFERENCES assets (id) ON DELETE SET NULL;
