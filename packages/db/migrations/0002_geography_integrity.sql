-- =============================================================================
-- Geography referential integrity
--
-- Plan §11 and §215 require that a stored city always belongs to the stored
-- governorate. Application validation gives a good error; this makes the invalid
-- pair unrepresentable, including under a race or a direct SQL fix-up.
--
-- The mechanism is a composite foreign key: by making (id, governorate_id)
-- uniquely addressable on `cities`, any table that stores both columns can
-- reference the pair rather than each column separately.
-- =============================================================================

ALTER TABLE cities
  ADD CONSTRAINT cities_id_governorate_key UNIQUE (id, governorate_id);

-- A customer's delivery address cannot name a city from another governorate.
ALTER TABLE user_addresses
  ADD CONSTRAINT user_addresses_city_governorate_fk
  FOREIGN KEY (city_id, governorate_id)
  REFERENCES cities (id, governorate_id) ON DELETE RESTRICT;

-- Neither can a restaurant branch (plan §16).
ALTER TABLE restaurant_branches
  ADD CONSTRAINT branches_city_governorate_fk
  FOREIGN KEY (city_id, governorate_id)
  REFERENCES cities (id, governorate_id) ON DELETE RESTRICT;

-- Nor an onboarding application (plan §179: "Restaurant cannot submit mismatched
-- city/governorate").
ALTER TABLE restaurant_applications
  ADD CONSTRAINT applications_city_governorate_fk
  FOREIGN KEY (city_id, governorate_id)
  REFERENCES cities (id, governorate_id) ON DELETE RESTRICT;

-- Nor a relocation request.
ALTER TABLE branch_location_change_requests
  ADD CONSTRAINT location_change_city_governorate_fk
  FOREIGN KEY (requested_city_id, requested_governorate_id)
  REFERENCES cities (id, governorate_id) ON DELETE RESTRICT;

-- A customer's profile geography follows the same rule (plan §11).
ALTER TABLE users
  ADD CONSTRAINT users_profile_city_governorate_fk
  FOREIGN KEY (profile_city_id, profile_governorate_id)
  REFERENCES cities (id, governorate_id) ON DELETE RESTRICT;

-- =============================================================================
-- Timestamp monotonicity on orders
--
-- Lifecycle timestamps must move forward. A clock skew or a bad backfill that
-- marks an order delivered before it was accepted would corrupt delivery-time
-- reporting and settlement membership.
-- =============================================================================

ALTER TABLE orders
  ADD CONSTRAINT orders_timestamps_ordered CHECK (
    (accepted_at           IS NULL OR accepted_at           >= placed_at)
    AND (ready_at          IS NULL OR ready_at              >= placed_at)
    AND (out_for_delivery_at IS NULL OR out_for_delivery_at >= placed_at)
    AND (delivered_at      IS NULL OR delivered_at          >= placed_at)
    AND (completed_at      IS NULL OR completed_at          >= placed_at)
  );

-- A completed order must have been delivered, and a delivered COD order must be
-- marked paid in cash — the invariant financial reconciliation depends on (plan §95).
ALTER TABLE orders
  ADD CONSTRAINT orders_completed_requires_delivery CHECK (
    status <> 'COMPLETED' OR (delivered_at IS NOT NULL AND payment_status = 'PAID_CASH')
  );

ALTER TABLE delivery_assignments
  ADD CONSTRAINT delivery_timestamps_ordered CHECK (
    (accepted_at          IS NULL OR accepted_at          >= assigned_at)
    AND (picked_up_at     IS NULL OR picked_up_at         >= assigned_at)
    AND (arrived_customer_at IS NULL OR arrived_customer_at >= assigned_at)
    AND (delivered_at     IS NULL OR delivered_at         >= assigned_at)
  );
