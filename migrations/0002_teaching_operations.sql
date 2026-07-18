-- 0002_teaching_operations: managed snapshot table for the teaching-operations store.
--
-- Mirrors uais_teaching_course_management_snapshots (a single-row jsonb snapshot
-- guarded by an optimistic-concurrency revision) so the file-based
-- teaching-operations store can be cut over to Postgres via
-- expand -> migrate -> contract. Idempotent; safe to re-apply.
CREATE TABLE IF NOT EXISTS uais_teaching_operations_snapshots (
  snapshot_key text PRIMARY KEY,
  database jsonb NOT NULL,
  revision text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
