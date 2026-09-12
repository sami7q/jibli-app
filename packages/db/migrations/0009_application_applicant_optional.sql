-- An applicant who does not have an account yet.
--
-- `applicant_user_id` has been NOT NULL since the first migration, which was
-- coherent while applications could only be created by Admin on behalf of
-- someone who was already a Jibli user. It stops being coherent the moment a
-- restaurant can apply for itself: requiring an account to ask for an account
-- is the loop the public form exists to break.
--
-- So the column becomes optional. It still carries the applicant when there is
-- one — an existing customer who also runs a restaurant — and is null when the
-- applicant is a stranger. Approval resolves the owner from
-- `contact_phone_e164` in that case, reusing the identity if the number is
-- already known and creating one if it is not, which is the same rule the
-- restaurant portal already applies when a restaurant adds a driver: one phone
-- is one person.

ALTER TABLE restaurant_applications
  ALTER COLUMN applicant_user_id DROP NOT NULL;

COMMENT ON COLUMN restaurant_applications.applicant_user_id IS
  'The applicant, when they already had an account. Null for a self-service application; the owner is then resolved from contact_phone_e164 at approval.';
