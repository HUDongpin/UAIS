-- 0005_user_login_identifiers: many sign-in identifiers, one account.
--
-- The cohort signs in with email, and EITHER a student's official or personal
-- address is acceptable. That rules out storing the email as `uais_users.account`:
--
--   1. Two addresses would resolve to two different accounts, so the same
--      student would become two actors - two chatroom rooms, two membership
--      records, two sets of transcripts - depending on which address they typed.
--   2. `account` is the teaching actorId and the chatroom author id, and eight
--      route-level validators independently require /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
--      with no '@'. An email-shaped account authenticates and then 401s on every
--      write.
--   3. Personal email changes. Anything keyed to it - memberships, groups,
--      audit rows, transcripts - would be orphaned by a student switching
--      providers.
--
-- So `uais_users.account` stays a stable, safe internal principal id, and this
-- table maps the addresses a student may sign in with onto it. Adding, changing
-- or removing an address is then a row here and touches no course data.
--
-- `identifier` is the PRIMARY KEY, which is what makes an address globally
-- unique: the same address can never point at two accounts.
--
-- PRIVACY: this table holds personal email addresses, which is a higher grade of
-- personal data than a student number. It is deliberately the ONLY place they
-- live - `uais_users` still carries no address - so retention and deletion for
-- them is a single-table operation. This belongs in the institutional retention
-- schedule the privacy baseline requires before a cohort starts.
--
-- Idempotent; safe to re-apply. The runner re-applies on every deploy and
-- checksum-locks the file once applied, so any correction ships as 0006.
CREATE TABLE IF NOT EXISTS uais_user_login_identifiers (
  identifier text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES uais_users(id) ON DELETE CASCADE,
  identifier_kind text NOT NULL DEFAULT 'email',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uais_user_login_identifiers_kind_check
    CHECK (identifier_kind IN ('email', 'account')),
  -- Stored lower-cased and compared exactly, so the primary key serves the
  -- lookup. A case-folding expression would not be indexable here.
  CONSTRAINT uais_user_login_identifiers_lowercase_check
    CHECK (identifier = lower(identifier))
);

-- Answers "which addresses does this account sign in with", for deletion and
-- for an operator correcting a roster.
CREATE INDEX IF NOT EXISTS uais_user_login_identifiers_user_id_idx
  ON uais_user_login_identifiers(user_id);
