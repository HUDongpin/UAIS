-- 0006_learning_chatroom_per_room: one transcript row per chatroom room.
--
-- 0003 gave chatroom transcripts a durable home as a SINGLE jsonb row keyed
-- 'default', mirroring uais_teaching_course_management_snapshots. That shape is
-- wrong for this resource for exactly the reason 0004 gives for not using it on
-- login failures: every append in the deployment took FOR UPDATE on the one row
-- and then rewrote the entire corpus, and the optimistic revision was a sha256
-- of all of it. Two students in two unrelated courses therefore serialised
-- behind each other, and a group room's members lost appends to conflicts raised
-- by people they share nothing with. Course management survives the pattern
-- because it has a handful of writers; a chatroom has one per member of every
-- live room, which is the same self-inflicted denial of service at 09:00 on the
-- first day of term, on the surface with the most concurrent writers.
--
-- The key is now the transcript id the application already derives per room
-- ('chatroom-transcript-<digest>' for a per-student room,
-- 'chatroom-group-transcript-<digest>' for a group room), so a row is contended
-- only by the members of ITS room and its revision moves only when that room
-- moves. The row still holds the same database envelope the application reads,
-- with a single-element "transcripts" array, so no reader learns a new shape.
--
-- Deliberately NOT changed: uais_learning_chatroom_share_snapshots. Shares are a
-- small, rarely written capability list with no per-room contention, and they
-- stay global by decision.
--
-- What this does, in the runner's transaction:
--   1. splits the 'default' row into one row per transcript it carried;
--   2. archives that row into ..._retired and deletes it from the live table, so
--      no code path can read it again - the store no longer knows the key, and
--      the corpus-wide read enumerates the live table only.
--
-- Rows the application has already written win: the split inserts ON CONFLICT DO
-- NOTHING, so a re-apply can never roll a live room back to its pre-split
-- contents. The migrated revision is a marker rather than a recomputed digest -
-- the application only ever compares a revision it read against the one in the
-- row, so it needs to be stable and unique, not reproducible.
--
-- Idempotent; safe to re-apply. The runner re-applies on every deploy and
-- checksum-locks the file once applied, so any correction ships as 0007.
CREATE TABLE IF NOT EXISTS uais_learning_chatroom_transcript_snapshots_retired (
  snapshot_key text PRIMARY KEY,
  database jsonb NOT NULL,
  revision text NOT NULL,
  updated_at timestamptz NOT NULL,
  retired_at timestamptz NOT NULL DEFAULT now()
);

-- MATERIALIZED rather than a plain WHERE on the join: jsonb_array_elements
-- raises on a non-array, so the "is it an array" guard has to be settled before
-- the expansion runs, not merely written earlier in the same statement.
WITH legacy AS MATERIALIZED (
  SELECT database, updated_at
  FROM uais_learning_chatroom_transcript_snapshots
  WHERE snapshot_key = 'default'
    AND jsonb_typeof(database->'transcripts') = 'array'
)
INSERT INTO uais_learning_chatroom_transcript_snapshots (
  snapshot_key, database, revision, updated_at
)
SELECT
  room.transcript->>'transcriptId',
  jsonb_build_object(
    'schemaVersion', legacy.database->>'schemaVersion',
    'updatedAt', legacy.database->>'updatedAt',
    'transcripts', jsonb_build_array(room.transcript)
  ),
  'rev-0006-' || md5(room.transcript::text),
  legacy.updated_at
FROM legacy
CROSS JOIN LATERAL jsonb_array_elements(legacy.database->'transcripts')
  AS room(transcript)
WHERE room.transcript->>'transcriptId' IS NOT NULL
ON CONFLICT (snapshot_key) DO NOTHING;

INSERT INTO uais_learning_chatroom_transcript_snapshots_retired (
  snapshot_key, database, revision, updated_at
)
SELECT snapshot_key, database, revision, updated_at
FROM uais_learning_chatroom_transcript_snapshots
WHERE snapshot_key = 'default'
ON CONFLICT (snapshot_key) DO NOTHING;

DELETE FROM uais_learning_chatroom_transcript_snapshots
WHERE snapshot_key = 'default';
