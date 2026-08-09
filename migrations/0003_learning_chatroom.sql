-- Learning-chatroom durable storage on the core database.
--
-- Group rooms refuse local JSON in a production runtime, which previously left
-- exactly one durable option: a separately operated external-storage service,
-- reachable only after an operator set a base URL and a bearer token. This gives
-- the same two resources a home on the managed Postgres the deployment already
-- requires (UAIS_CORE_DATABASE_URL), so a correctly provisioned production
-- deployment has durable transcripts and share links with no additional
-- configuration and no second service to keep in version step.
--
-- Mirrors uais_teaching_course_management_snapshots exactly: a single-row jsonb
-- snapshot guarded by an optimistic-concurrency revision. Idempotent; safe to
-- re-apply.
CREATE TABLE IF NOT EXISTS uais_learning_chatroom_transcript_snapshots (
  snapshot_key text PRIMARY KEY,
  database jsonb NOT NULL,
  revision text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uais_learning_chatroom_share_snapshots (
  snapshot_key text PRIMARY KEY,
  database jsonb NOT NULL,
  revision text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
