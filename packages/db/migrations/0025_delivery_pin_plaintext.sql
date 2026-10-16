-- The delivery PIN the customer is meant to read back to the courier.
--
-- The PIN is a COD handover code: the courier asks for it, the customer reads
-- it off their own screen, and it proves the courier reached the right person.
-- It was stored only as a hash (orders.delivery_pin_hash), returned once in the
-- POST /orders response, and then thrown away by the app — so GET /orders/:id
-- could never show it again and every COD order stuck at «قيد التوصيل»
-- (CUST-1 / FLOW-1).
--
-- Unlike an OTP or a password, this code is not a secret kept from its owner:
-- the customer is supposed to see it. So we also keep the plaintext, and the
-- API returns it ONLY to the order's own customer and ONLY while the order is
-- in flight (ACCEPTED…OUT_FOR_DELIVERY). It is never in the owner or courier
-- payloads, never logged, and the verification hash stays the source of truth
-- for confirming delivery.
--
-- Nullable because orders placed with the feature flag off have no PIN, and
-- because every order already in the table predates this column.
ALTER TABLE orders
  ADD COLUMN delivery_pin_plaintext text;
