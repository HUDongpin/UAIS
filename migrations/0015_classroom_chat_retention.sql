-- Complete classroom discussion records live independently of the bounded
-- realtime snapshot. Backfill only messages still retained at migration time;
-- this cannot recover messages discarded by earlier rolling-window versions.
CREATE TABLE IF NOT EXISTS uais_learning_chatroom_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transcript_id text NOT NULL,
  message_id text NOT NULL,
  course_external_id text NOT NULL,
  message jsonb NOT NULL CHECK (jsonb_typeof(message) = 'object'),
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transcript_id, message_id)
);
CREATE INDEX IF NOT EXISTS uais_learning_chatroom_messages_room_cursor_idx
  ON uais_learning_chatroom_messages(transcript_id, id DESC);
CREATE INDEX IF NOT EXISTS uais_learning_chatroom_messages_course_idx
  ON uais_learning_chatroom_messages(course_external_id);

INSERT INTO uais_learning_chatroom_messages (transcript_id, message_id, course_external_id, message)
SELECT room->>'transcriptId', item->>'messageId', room->>'courseId', item
FROM uais_learning_chatroom_transcript_snapshots snapshot
CROSS JOIN LATERAL jsonb_array_elements(snapshot.database->'transcripts') AS rooms(room)
CROSS JOIN LATERAL jsonb_array_elements(room->'messages') WITH ORDINALITY AS messages(item, position)
WHERE room->>'transcriptId' IS NOT NULL AND room->>'courseId' IS NOT NULL AND item->>'messageId' IS NOT NULL
ORDER BY snapshot.snapshot_key, position
ON CONFLICT (transcript_id, message_id) DO NOTHING;

-- A row is created only when the owner ends the classroom record period.
-- Retain the small tombstone after a confirmed purge to stop stale clients
-- recreating deleted student records. No automatic destructive job is added.
CREATE TABLE IF NOT EXISTS uais_course_record_retention (
  course_external_id text PRIMARY KEY,
  closed_at timestamptz NOT NULL,
  purge_after timestamptz NOT NULL,
  purged_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (purge_after = closed_at + interval '180 days'),
  CHECK (purged_at IS NULL OR purged_at >= purge_after)
);
