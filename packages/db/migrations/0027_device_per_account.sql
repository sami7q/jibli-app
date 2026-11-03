-- One phone, several accounts.
--
-- A push token was unique across the table, so the last account to register
-- a phone took it: a shop owner who also orders as a customer on the same
-- phone stopped receiving new-order alerts the moment the customer side
-- re-registered on launch. A token is now unique per account instead — the
-- phone is reachable for every account signed in on it, and signing out
-- revokes that account's row (see POST /api/v1/auth/logout).
DROP INDEX IF EXISTS user_devices_token_key;
CREATE UNIQUE INDEX IF NOT EXISTS user_devices_token_user_key
  ON user_devices (push_token, user_id);
