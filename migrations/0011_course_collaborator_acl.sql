-- 0011_course_collaborator_acl: canonical, course-scoped collaborator grants.
--
-- Login addresses remain confined to uais_user_login_identifiers.identifier.
-- The new identifier_id is an opaque internal delivery reference: grants and
-- notification jobs can identify the selected registered address while it is
-- retained, without copying the address or deriving another value from it.
-- Public receipts and audits omit the identifier, and deletion nulls internal
-- references so these tables do not extend raw-address retention.

ALTER TABLE uais_user_login_identifiers
  ADD COLUMN IF NOT EXISTS identifier_id uuid;

UPDATE uais_user_login_identifiers
SET identifier_id = gen_random_uuid()
WHERE identifier_id IS NULL;

ALTER TABLE uais_user_login_identifiers
  ALTER COLUMN identifier_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN identifier_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uais_user_login_identifiers_identifier_id_unique
  ON uais_user_login_identifiers (identifier_id);

CREATE UNIQUE INDEX IF NOT EXISTS uais_user_login_identifiers_user_identifier_id_unique
  ON uais_user_login_identifiers (user_id, identifier_id);

CREATE TABLE IF NOT EXISTS uais_course_collaborator_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id text NOT NULL
    REFERENCES uais_teaching_course_management_snapshots(snapshot_key)
    ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL
    REFERENCES uais_users(id)
    ON DELETE CASCADE,
  recipient_identifier_id uuid
    REFERENCES uais_user_login_identifiers(identifier_id)
    ON DELETE SET NULL,
  granted_by_user_id uuid NOT NULL
    REFERENCES uais_users(id)
    ON DELETE RESTRICT,
  role text NOT NULL
    CHECK (role IN ('observer', 'reviewer', 'teaching-assistant', 'co-instructor')),
  scopes text[] NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid
    REFERENCES uais_users(id)
    ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, recipient_user_id),
  CHECK (recipient_user_id <> granted_by_user_id),
  CHECK (revision > 0),
  CHECK (cardinality(scopes) > 0),
  CHECK (array_position(scopes, NULL) IS NULL),
  CHECK (expires_at IS NULL OR expires_at > granted_at),
  CHECK (revoked_at IS NULL OR revoked_at >= granted_at),
  CHECK ((revoked_at IS NULL) = (revoked_by_user_id IS NULL)),
  CONSTRAINT uais_course_collaborator_grants_recipient_identifier_owner_fk
    FOREIGN KEY (recipient_user_id, recipient_identifier_id)
    REFERENCES uais_user_login_identifiers(user_id, identifier_id),
  CONSTRAINT uais_course_collaborator_grants_role_ceiling_check
    CHECK (
      (role = 'observer'
        AND scopes <@ ARRAY['course.read']::text[])
      OR
      (role = 'reviewer'
        AND scopes <@ ARRAY['course.read', 'course.grading.manage']::text[])
      OR
      (role = 'teaching-assistant'
        AND scopes <@ ARRAY['course.read', 'course.content.write', 'course.students.manage', 'course.grading.manage']::text[])
      OR
      (role = 'co-instructor'
        AND scopes <@ ARRAY['course.read', 'course.content.write', 'course.students.manage', 'course.grading.manage', 'course.settings.manage', 'course.export']::text[])
    )
);

CREATE INDEX IF NOT EXISTS uais_course_collaborator_grants_recipient_idx
  ON uais_course_collaborator_grants (recipient_user_id, course_id);

CREATE INDEX IF NOT EXISTS uais_course_collaborator_grants_active_idx
  ON uais_course_collaborator_grants (course_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS uais_course_collaborator_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL
    REFERENCES uais_course_collaborator_grants(id)
    ON DELETE CASCADE,
  grant_revision bigint NOT NULL CHECK (grant_revision > 0),
  recipient_user_id uuid NOT NULL
    REFERENCES uais_users(id)
    ON DELETE CASCADE,
  recipient_identifier_id uuid
    REFERENCES uais_user_login_identifiers(identifier_id)
    ON DELETE SET NULL,
  event_type text NOT NULL
    CHECK (event_type IN ('grant-issued', 'grant-revoked')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'dead')),
  attempt_count integer NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0 AND attempt_count <= 10),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_category text,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (grant_id, event_type, grant_revision),
  CONSTRAINT uais_course_collaborator_outbox_recipient_identifier_owner_fk
    FOREIGN KEY (recipient_user_id, recipient_identifier_id)
    REFERENCES uais_user_login_identifiers(user_id, identifier_id),
  CHECK (
    (status = 'processing' AND locked_at IS NOT NULL AND locked_by IS NOT NULL)
    OR
    (status <> 'processing' AND locked_at IS NULL AND locked_by IS NULL)
  ),
  CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS uais_course_collaborator_notification_dispatch_idx
  ON uais_course_collaborator_notification_outbox (
    status,
    next_attempt_at,
    created_at
  );

CREATE INDEX IF NOT EXISTS uais_course_collaborator_notification_backlog_idx
  ON uais_course_collaborator_notification_outbox (created_at)
  WHERE status IN ('pending', 'failed', 'dead');
