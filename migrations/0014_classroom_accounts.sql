-- First-party classroom provisioning. Initial secrets are stored only as the
-- existing scrypt password_hash. No plaintext credential recovery store.
CREATE TABLE IF NOT EXISTS uais_classroom_account_onboarding (
  user_id uuid PRIMARY KEY REFERENCES uais_users(id) ON DELETE CASCADE,
  provisioned_by text NOT NULL,
  course_key text NOT NULL,
  class_key text NOT NULL,
  credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uais_classroom_account_onboarding_owner_idx
  ON uais_classroom_account_onboarding(provisioned_by, course_key, class_key);
