-- UAIS P1 authoritative learning events, projections and durable xAPI mirror.

INSERT INTO uais_audit_log (action, target_type, target_id, metadata)
SELECT
  'migration-preflight',
  'schema',
  '0009_learning_event_outbox',
  jsonb_build_object(
    'learningEventsTotal', (SELECT count(*) FROM uais_learning_events),
    'learnerProfilesTotal', (SELECT count(*) FROM uais_learner_profiles),
    'recommendationsTotal', (SELECT count(*) FROM uais_recommendations)
  );

ALTER TABLE uais_learning_events
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS projection_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assessment_id uuid REFERENCES uais_assessments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submission_id uuid REFERENCES uais_submissions(id) ON DELETE SET NULL;

UPDATE uais_learning_events
SET idempotency_key = 'legacy:' || id::text
WHERE idempotency_key IS NULL;

ALTER TABLE uais_learning_events
  ALTER COLUMN idempotency_key SET NOT NULL,
  ADD CONSTRAINT uais_learning_events_schema_version_check CHECK (schema_version > 0),
  ADD CONSTRAINT uais_learning_events_projection_version_check CHECK (projection_version >= 0),
  ADD CONSTRAINT uais_learning_events_source_check
    CHECK (source IN ('legacy', 'learning-loop-api', 'ppt-playback'));

CREATE UNIQUE INDEX IF NOT EXISTS uais_learning_events_idempotency_key_unique
  ON uais_learning_events(idempotency_key);

ALTER TABLE uais_learner_profiles
  ADD COLUMN IF NOT EXISTS progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS projection_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz;

ALTER TABLE uais_learner_profiles
  ADD CONSTRAINT uais_learner_profiles_progress_check CHECK (jsonb_typeof(progress) = 'object'),
  ADD CONSTRAINT uais_learner_profiles_projection_version_check CHECK (projection_version >= 0);

ALTER TABLE uais_recommendations
  ADD COLUMN IF NOT EXISTS reason_code text NOT NULL DEFAULT 'legacy-rationale',
  ADD COLUMN IF NOT EXISTS next_action_type text NOT NULL DEFAULT 'collect-more-evidence',
  ADD COLUMN IF NOT EXISTS source_state_version integer NOT NULL DEFAULT 0;

ALTER TABLE uais_recommendations
  ADD CONSTRAINT uais_recommendations_source_state_version_check CHECK (source_state_version >= 0);

CREATE TABLE IF NOT EXISTS uais_xapi_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_event_id uuid NOT NULL REFERENCES uais_learning_events(id) ON DELETE CASCADE,
  statement_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'dead')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0 AND attempt_count <= 10),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error_category text,
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (learning_event_id),
  UNIQUE (statement_id)
);

CREATE TABLE IF NOT EXISTS uais_idempotency_records (
  idempotency_key text PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES uais_users(id) ON DELETE CASCADE,
  scope text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  resource_id text NOT NULL,
  response_receipt jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(response_receipt) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS uais_learning_events_submission_time_idx
  ON uais_learning_events(submission_id, occurred_at DESC)
  WHERE submission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS uais_xapi_outbox_dispatch_idx
  ON uais_xapi_outbox(status, next_attempt_at, created_at);
CREATE INDEX IF NOT EXISTS uais_xapi_outbox_backlog_age_idx
  ON uais_xapi_outbox(created_at)
  WHERE status IN ('pending', 'failed', 'dead');
CREATE INDEX IF NOT EXISTS uais_idempotency_records_actor_scope_idx
  ON uais_idempotency_records(actor_user_id, scope, created_at DESC);
