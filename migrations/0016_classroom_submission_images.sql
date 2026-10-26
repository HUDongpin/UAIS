-- Bounded private classroom images belong to immutable submission versions.
ALTER TABLE uais_submission_versions ADD COLUMN IF NOT EXISTS evidence_hash text;

CREATE TABLE IF NOT EXISTS uais_submission_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_version_id uuid NOT NULL REFERENCES uais_submission_versions(id) ON DELETE CASCADE,
  client_attachment_id uuid NOT NULL,
  position integer NOT NULL CHECK (position > 0),
  mime text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg')),
  byte_length integer NOT NULL CHECK (byte_length > 0 AND byte_length <= 1048576),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  content bytea NOT NULL CHECK (octet_length(content) = byte_length),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uais_submission_attachment_client_unique UNIQUE (submission_version_id, client_attachment_id),
  CONSTRAINT uais_submission_attachment_position_unique UNIQUE (submission_version_id, position),
  CONSTRAINT uais_submission_attachment_pixels CHECK (width::bigint * height::bigint <= 40000000)
);
-- The unique constraints index the version FK, pagination and idempotency lookup.
