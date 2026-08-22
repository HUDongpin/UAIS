-- UAIS P1 learning evidence, immutable versions and teacher feedback.
-- Additive by design: legacy columns and rows remain readable after application rollback.

INSERT INTO uais_audit_log (action, target_type, target_id, metadata)
SELECT
  'migration-preflight',
  'schema',
  '0008_learning_closed_loop_domain',
  jsonb_build_object(
    'submissionsTotal', count(*),
    'legacyReviewed', count(*) FILTER (WHERE state = 'reviewed'),
    'legacyReturned', count(*) FILTER (WHERE state = 'returned'),
    'legacyContentReferences', count(*) FILTER (WHERE content_ref IS NOT NULL)
  )
FROM uais_submissions;

ALTER TABLE uais_lessons
  ADD COLUMN IF NOT EXISTS external_key text,
  ADD COLUMN IF NOT EXISTS published_manifest_ref text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published';

ALTER TABLE uais_lessons
  ADD CONSTRAINT uais_lessons_status_check
  CHECK (status IN ('draft', 'published', 'archived'));

CREATE UNIQUE INDEX IF NOT EXISTS uais_lessons_course_external_key_unique
  ON uais_lessons(course_id, external_key)
  WHERE external_key IS NOT NULL;

ALTER TABLE uais_classes
  ADD COLUMN IF NOT EXISTS external_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uais_classes_course_external_key_unique
  ON uais_classes(course_id, external_key)
  WHERE external_key IS NOT NULL;

ALTER TABLE uais_assessments
  ADD COLUMN IF NOT EXISTS activity_key text,
  ADD COLUMN IF NOT EXISTS title_i18n jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS instructions_i18n jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS edit_revision integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS rubric jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS formative_check jsonb,
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_policy text NOT NULL DEFAULT 'teacher-requested-draft',
  ADD COLUMN IF NOT EXISTS revision_policy text NOT NULL DEFAULT 'teacher-requested',
  ADD COLUMN IF NOT EXISTS target_class_external_id text,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE uais_assessments
  ADD CONSTRAINT uais_assessments_status_check
    CHECK (status IN ('draft', 'published', 'archived')),
  ADD CONSTRAINT uais_assessments_version_check
    CHECK (version > 0),
  ADD CONSTRAINT uais_assessments_edit_revision_check
    CHECK (edit_revision > 0),
  ADD CONSTRAINT uais_assessments_title_i18n_check
    CHECK (jsonb_typeof(title_i18n) = 'object'),
  ADD CONSTRAINT uais_assessments_instructions_i18n_check
    CHECK (jsonb_typeof(instructions_i18n) = 'object'),
  ADD CONSTRAINT uais_assessments_rubric_check
    CHECK (jsonb_typeof(rubric) = 'array'),
  ADD CONSTRAINT uais_assessments_ai_policy_check
    CHECK (ai_policy IN ('teacher-requested-draft', 'disabled')),
  ADD CONSTRAINT uais_assessments_revision_policy_check
    CHECK (revision_policy = 'teacher-requested');

CREATE UNIQUE INDEX IF NOT EXISTS uais_assessments_lesson_activity_version_unique
  ON uais_assessments(lesson_id, activity_key, version)
  WHERE activity_key IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM uais_submissions
    GROUP BY assessment_id, user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '0008 preflight blocked: duplicate legacy assessment/user submissions require audited reconciliation.';
  END IF;
END
$$;

ALTER TABLE uais_submissions
  ADD COLUMN IF NOT EXISTS legacy_content_ref text,
  ADD COLUMN IF NOT EXISTS class_external_id text,
  ADD COLUMN IF NOT EXISTS current_version_no integer,
  ADD COLUMN IF NOT EXISTS last_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_version_id uuid;

UPDATE uais_submissions
SET legacy_content_ref = content_ref
WHERE legacy_content_ref IS NULL AND content_ref IS NOT NULL;

UPDATE uais_submissions
SET current_version_no = 0
WHERE current_version_no IS NULL;

ALTER TABLE uais_submissions
  ALTER COLUMN current_version_no SET DEFAULT 1,
  ALTER COLUMN current_version_no SET NOT NULL,
  DROP CONSTRAINT IF EXISTS uais_submissions_state_check;

UPDATE uais_submissions
SET state = CASE state
  WHEN 'reviewed' THEN 'accepted'
  WHEN 'returned' THEN 'revision_requested'
  ELSE state
END;

ALTER TABLE uais_submissions
  ADD CONSTRAINT uais_submissions_state_check
    CHECK (state IN ('draft', 'submitted', 'revision_requested', 'resubmitted', 'accepted')),
  ADD CONSTRAINT uais_submissions_current_version_check
    CHECK (current_version_no >= 0);

ALTER TABLE uais_submissions
  ADD CONSTRAINT uais_submissions_assessment_user_unique
  UNIQUE (assessment_id, user_id);

CREATE TABLE IF NOT EXISTS uais_submission_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES uais_submissions(id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sealed')),
  content_text text NOT NULL CHECK (char_length(content_text) <= 20000),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  draft_revision integer NOT NULL DEFAULT 1 CHECK (draft_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  UNIQUE (submission_id, version_no)
);

ALTER TABLE uais_submission_versions
  ADD CONSTRAINT uais_submission_versions_id_submission_unique
    UNIQUE (id, submission_id),
  ADD CONSTRAINT uais_submission_versions_sealed_timestamp_check
    CHECK (
      (status = 'draft' AND submitted_at IS NULL)
      OR (status = 'sealed' AND submitted_at IS NOT NULL)
    );

ALTER TABLE uais_submissions
  DROP CONSTRAINT IF EXISTS uais_submissions_accepted_version_fk,
  ADD CONSTRAINT uais_submissions_accepted_version_fk
    FOREIGN KEY (accepted_version_id, id)
    REFERENCES uais_submission_versions(id, submission_id) ON DELETE RESTRICT,
  ADD CONSTRAINT uais_submissions_accepted_state_version_check
    CHECK (
      state <> 'accepted'
      OR accepted_version_id IS NOT NULL
      OR current_version_no = 0
    );

CREATE TABLE IF NOT EXISTS uais_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES uais_submissions(id) ON DELETE CASCADE,
  submission_version_id uuid NOT NULL REFERENCES uais_submission_versions(id) ON DELETE RESTRICT,
  teacher_user_id uuid NOT NULL REFERENCES uais_users(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK (origin IN ('teacher', 'ai-assisted')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'released', 'superseded')),
  rubric_judgments jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(rubric_judgments) = 'object'),
  feedback_text text NOT NULL DEFAULT '',
  requires_revision boolean NOT NULL DEFAULT false,
  ai_trace_ref text,
  source_draft_revision integer NOT NULL DEFAULT 1 CHECK (source_draft_revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);

ALTER TABLE uais_feedback
  ADD CONSTRAINT uais_feedback_version_submission_fk
    FOREIGN KEY (submission_version_id, submission_id)
    REFERENCES uais_submission_versions(id, submission_id) ON DELETE RESTRICT,
  ADD CONSTRAINT uais_feedback_release_consistency_check
    CHECK (
      (status = 'draft' AND released_at IS NULL)
      OR (status IN ('released', 'superseded') AND released_at IS NOT NULL)
    ),
  ADD CONSTRAINT uais_feedback_released_text_check
    CHECK (status = 'draft' OR char_length(btrim(feedback_text)) > 0),
  ADD CONSTRAINT uais_feedback_ai_trace_ref_check
    CHECK (ai_trace_ref IS NULL OR ai_trace_ref ~ '^[0-9a-f]{64}$');

CREATE TABLE IF NOT EXISTS uais_formative_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES uais_assessments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES uais_users(id) ON DELETE CASCADE,
  class_external_id text NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  response_json jsonb NOT NULL CHECK (jsonb_typeof(response_json) = 'object'),
  response_hash text NOT NULL CHECK (response_hash ~ '^[0-9a-f]{64}$'),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assessment_id, user_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS uais_submission_versions_submission_status_idx
  ON uais_submission_versions(submission_id, status, version_no DESC);
CREATE INDEX IF NOT EXISTS uais_feedback_submission_version_status_idx
  ON uais_feedback(submission_id, submission_version_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS uais_feedback_teacher_status_idx
  ON uais_feedback(teacher_user_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uais_feedback_teacher_version_draft_unique
  ON uais_feedback(submission_version_id, teacher_user_id)
  WHERE status = 'draft';
CREATE INDEX IF NOT EXISTS uais_formative_attempts_assessment_user_idx
  ON uais_formative_attempts(assessment_id, user_id, attempted_at DESC);
