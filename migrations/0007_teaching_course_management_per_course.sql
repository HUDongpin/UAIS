-- 0007_teaching_course_management_per_course: one course-management row per course.
--
-- 0001 gave course management a durable home as a SINGLE jsonb row keyed
-- 'default', holding every course, class, membership, invite-code draft,
-- learning group and audit event in the deployment. 0006 has already retired
-- that shape for chatroom transcripts; this retires it where it started. 0004
-- states the rule both migrations follow: a row is a unit of contention, so a
-- resource whose writers are independent must not share one.
--
-- Course management survived the pattern longer than the chatroom did because it
-- has fewer writers, but the same three costs were already being paid:
--   * every teacher action and every student join took FOR UPDATE on the one row
--     and rewrote the entire corpus, so an approval in one department could lose
--     to a class creation in another;
--   * the optimistic revision was a sha256 of everything, so it moved whenever
--     anyone anywhere wrote, and the handlers' single retry was spent on
--     conflicts that had nothing to do with them;
--   * the chatroom's authorization read pulled the whole corpus on EVERY 2.5s
--     poll to answer a question about one course - the read that grows with the
--     size of the university and is issued once per learner per two seconds.
--
-- The key is now the course id the application already mints
-- ('teacher-course-<slug>-<stamp>', or the teacher's provisional draft id), so a
-- row is contended only by the people working on ITS course and its revision
-- moves only when that course moves. The row still holds the same database
-- envelope the application reads, carrying just that course's records, so no
-- reader learns a new shape.
--
-- NOT partitioned, because it cannot be: the 8-digit INVITE CODE namespace. A
-- student joins with the bare code and no course context, so two courses must
-- never mint the same one, and no per-course row can enforce that. It gets the
-- dedicated table below, which every course write reconciles inside the same
-- transaction; a cross-course collision aborts that write and the handler
-- re-allocates against a freshly read corpus. Everything else in the envelope
-- carries a required courseId - the audit log included - so nothing else needed
-- a home outside its course.
--
-- What this does, in the runner's transaction:
--   1. creates the invite-code claims table;
--   2. splits the 'default' row into one row per course id it carried;
--   3. seeds the claims from the codes that row already held;
--   4. archives the 'default' row into ..._retired and deletes it from the live
--      table, so no code path can read it again - the store no longer knows the
--      key, and the corpus-wide read enumerates the live table only.
--
-- Rows the application has already written win: the split inserts ON CONFLICT DO
-- NOTHING, so a re-apply can never roll a live course back to its pre-split
-- contents. The migrated revision is a marker rather than a recomputed digest -
-- the application only ever compares a revision it read against the one in the
-- row, so it needs to be stable and unique, not reproducible.
--
-- Idempotent; safe to re-apply. The runner re-applies on every deploy and
-- checksum-locks the file once applied, so any correction ships as 0008.
CREATE TABLE IF NOT EXISTS uais_teaching_class_invite_code_claims (
  invite_code text PRIMARY KEY,
  course_id text NOT NULL,
  class_id text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

-- The store releases a course's stale claims by course_id on every write, and
-- there is no other way into this table by course.
CREATE INDEX IF NOT EXISTS uais_teaching_class_invite_code_claims_course_id_idx
  ON uais_teaching_class_invite_code_claims (course_id);

CREATE TABLE IF NOT EXISTS uais_teaching_course_management_snapshots_retired (
  snapshot_key text PRIMARY KEY,
  database jsonb NOT NULL,
  revision text NOT NULL,
  updated_at timestamptz NOT NULL,
  retired_at timestamptz NOT NULL DEFAULT now()
);

-- MATERIALIZED on every CTE that settles a jsonb_typeof guard: jsonb_each and
-- jsonb_array_elements raise on the wrong type, so "is it an array" has to be
-- decided before the expansion runs, not merely written earlier in the same
-- statement.
--
-- The split is written over the legacy object's OWN keys rather than a
-- hand-listed field map. The envelope carries ~25 record arrays and keeps
-- growing; a field list that fell one release behind would silently drop
-- whichever array shipped last out of every course row it wrote, and nothing
-- would fail loudly. Scalars (schemaVersion, updatedAt) ride along unchanged;
-- every array is filtered to the course being written. A course therefore gets
-- an empty array for a key it has no records under, which is exactly what the
-- store's own per-course write produces.
WITH legacy AS MATERIALIZED (
  SELECT database, updated_at
  FROM uais_teaching_course_management_snapshots
  WHERE snapshot_key = 'default'
    AND jsonb_typeof(database) = 'object'
),
legacy_arrays AS MATERIALIZED (
  SELECT entry.key AS key, entry.value AS items
  FROM legacy
  CROSS JOIN LATERAL jsonb_each(legacy.database) AS entry(key, value)
  WHERE jsonb_typeof(entry.value) = 'array'
),
legacy_scalars AS MATERIALIZED (
  SELECT COALESCE(jsonb_object_agg(entry.key, entry.value), '{}'::jsonb) AS fields
  FROM legacy
  CROSS JOIN LATERAL jsonb_each(legacy.database) AS entry(key, value)
  WHERE jsonb_typeof(entry.value) <> 'array'
),
-- Every course id the row mentions anywhere, not only the ones with a `courses`
-- entry: a settings or audit record whose course was already gone still belongs
-- to that course id, and stranding it in the archived row would lose it.
course_keys AS (
  SELECT DISTINCT record.value->>'courseId' AS course_id
  FROM legacy_arrays
  CROSS JOIN LATERAL jsonb_array_elements(legacy_arrays.items) AS record(value)
  WHERE record.value->>'courseId' IS NOT NULL
),
course_rows AS (
  SELECT
    course_keys.course_id AS course_id,
    legacy.updated_at AS updated_at,
    legacy_scalars.fields || jsonb_object_agg(
      legacy_arrays.key,
      (
        SELECT COALESCE(jsonb_agg(record.value), '[]'::jsonb)
        FROM jsonb_array_elements(legacy_arrays.items) AS record(value)
        WHERE record.value->>'courseId' = course_keys.course_id
      )
    ) AS database
  FROM course_keys
  CROSS JOIN legacy
  CROSS JOIN legacy_scalars
  CROSS JOIN legacy_arrays
  GROUP BY course_keys.course_id, legacy.updated_at, legacy_scalars.fields
)
INSERT INTO uais_teaching_course_management_snapshots (
  snapshot_key, database, revision, updated_at
)
SELECT
  course_rows.course_id,
  course_rows.database,
  'rev-0007-' || md5(course_rows.database::text),
  course_rows.updated_at
FROM course_rows
ON CONFLICT (snapshot_key) DO NOTHING;

-- The codes the retired row already held, from the same three places the
-- allocator counts them: published class codes, unpublished drafts, and the copy
-- a membership keeps of the code it joined with. A published class wins the
-- attribution when the same code appears more than once, and DO NOTHING keeps a
-- claim the running application has since written.
WITH legacy_classes AS MATERIALIZED (
  SELECT database->'classes' AS items
  FROM uais_teaching_course_management_snapshots
  WHERE snapshot_key = 'default'
    AND jsonb_typeof(database->'classes') = 'array'
),
legacy_drafts AS MATERIALIZED (
  SELECT database->'inviteCodeDrafts' AS items
  FROM uais_teaching_course_management_snapshots
  WHERE snapshot_key = 'default'
    AND jsonb_typeof(database->'inviteCodeDrafts') = 'array'
),
legacy_memberships AS MATERIALIZED (
  SELECT database->'memberships' AS items
  FROM uais_teaching_course_management_snapshots
  WHERE snapshot_key = 'default'
    AND jsonb_typeof(database->'memberships') = 'array'
),
claims AS (
  SELECT
    item.value->>'invitationCode' AS invite_code,
    item.value->>'courseId' AS course_id,
    item.value->>'classId' AS class_id,
    1 AS claim_priority
  FROM legacy_classes
  CROSS JOIN LATERAL jsonb_array_elements(legacy_classes.items) AS item(value)
  UNION ALL
  SELECT
    item.value->>'inviteCode',
    item.value->>'courseId',
    item.value->>'classId',
    2
  FROM legacy_drafts
  CROSS JOIN LATERAL jsonb_array_elements(legacy_drafts.items) AS item(value)
  UNION ALL
  SELECT
    item.value->>'invitationCode',
    item.value->>'courseId',
    item.value->>'classId',
    3
  FROM legacy_memberships
  CROSS JOIN LATERAL jsonb_array_elements(legacy_memberships.items) AS item(value)
)
INSERT INTO uais_teaching_class_invite_code_claims (
  invite_code, course_id, class_id, claimed_at
)
SELECT DISTINCT ON (claims.invite_code)
  claims.invite_code, claims.course_id, claims.class_id, now()
FROM claims
WHERE claims.invite_code IS NOT NULL
  AND claims.course_id IS NOT NULL
  AND claims.class_id IS NOT NULL
ORDER BY claims.invite_code, claims.claim_priority
ON CONFLICT (invite_code) DO NOTHING;

INSERT INTO uais_teaching_course_management_snapshots_retired (
  snapshot_key, database, revision, updated_at
)
SELECT snapshot_key, database, revision, updated_at
FROM uais_teaching_course_management_snapshots
WHERE snapshot_key = 'default'
ON CONFLICT (snapshot_key) DO NOTHING;

DELETE FROM uais_teaching_course_management_snapshots
WHERE snapshot_key = 'default';
