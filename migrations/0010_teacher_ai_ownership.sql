-- 0010_teacher_ai_ownership: durable, redacted AI resource identifiers per teacher.
--
-- Course ownership deliberately does NOT live here. The authoritative ACL is
-- the course record inside uais_teaching_course_management_snapshots, partitioned
-- one row per course by 0007. The runtime joins/locks those rows whenever it
-- reads or merges teacher resources. Copying courseIds into this table would
-- create a second ACL that could survive course rollback or owner transfer.
--
-- Only public application identifiers are accepted by the TypeScript store:
-- sample asset ids, PPT asset ids, cloned voice reference ids and audio manifest
-- ids plus their public relationships. Provider ids, source paths, credentials
-- and media payloads are neither columns nor recognized JSON fields.
--
-- The row exists as the serialization point for concurrent first writes. A
-- transaction inserts an empty row ON CONFLICT DO NOTHING, then selects it FOR
-- UPDATE and merges the latest resources. That ordering makes the unique key
-- block a simultaneous first writer until it can observe the first commit.
CREATE TABLE IF NOT EXISTS uais_teacher_ai_ownership (
  teacher_id text PRIMARY KEY
    CHECK (teacher_id ~ '^[A-Za-z0-9_-]+$'),
  resources jsonb NOT NULL DEFAULT '{
    "sampleAssets": [],
    "pptAssets": [],
    "clonedVoiceRefs": [],
    "audioManifests": []
  }'::jsonb
    CHECK (jsonb_typeof(resources) = 'object'),
  revision bigint NOT NULL DEFAULT 0
    CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
