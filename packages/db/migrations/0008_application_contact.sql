-- Who is applying.
--
-- `restaurant_applications` has carried `contact_phone_e164` from the first
-- migration, and nothing else about the person behind it. That was survivable
-- while applications could only be created by Admin, who already had the owner
-- on the phone and a name in their head. It is not survivable now that a
-- restaurant can apply for itself.
--
-- So: a name to go with the number already stored, and a free-text note for
-- whatever the applicant wants the reviewer to know.
--
-- `applicant_user_id` exists and stays. It is for an applicant who already has
-- a Jibli account; these are for the ordinary case, where they do not have one
-- and the whole point is that they should not need one.

ALTER TABLE restaurant_applications
  ADD COLUMN IF NOT EXISTS applicant_name text,
  ADD COLUMN IF NOT EXISTS applicant_note text;

COMMENT ON COLUMN restaurant_applications.applicant_name IS
  'The person who submitted the application. Null on rows created by Admin.';

-- A restaurant that applies twice in a day did not hear back; it is not a
-- second restaurant. This is what lets the public endpoint see that cheaply
-- before writing another row.
CREATE INDEX IF NOT EXISTS restaurant_applications_contact_phone_idx
  ON restaurant_applications (contact_phone_e164, created_at DESC);
