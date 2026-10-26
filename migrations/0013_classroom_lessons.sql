-- Additive authored lesson catalog. Legacy manifests and submissions remain intact.
ALTER TABLE uais_lessons
  ADD COLUMN content_kind text NOT NULL DEFAULT 'legacy',
  ADD COLUMN draft_package jsonb,
  ADD COLUMN draft_revision integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT uais_lessons_content_kind_check CHECK (content_kind IN ('legacy', 'authored')),
  ADD CONSTRAINT uais_lessons_draft_revision_check CHECK (draft_revision >= 0);

CREATE TABLE uais_lesson_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES uais_lessons(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no > 0),
  primary_locale text NOT NULL CHECK (primary_locale IN ('zh-CN', 'en-US')),
  student_content jsonb NOT NULL CHECK (jsonb_typeof(student_content) = 'object'),
  teacher_guide jsonb NOT NULL CHECK (jsonb_typeof(teacher_guide) = 'object'),
  target_class_ids jsonb NOT NULL CHECK (jsonb_typeof(target_class_ids) = 'array' AND jsonb_array_length(target_class_ids) > 0),
  draft_revision integer NOT NULL CHECK (draft_revision > 0),
  published_by uuid NOT NULL REFERENCES uais_users(id) ON DELETE RESTRICT,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, version_no),
  UNIQUE (id, lesson_id)
);
CREATE INDEX uais_lesson_versions_published_by_idx ON uais_lesson_versions(published_by);
ALTER TABLE uais_assessments ADD COLUMN lesson_version_id uuid;
ALTER TABLE uais_assessments ADD CONSTRAINT uais_assessments_lesson_version_fk
  FOREIGN KEY (lesson_version_id, lesson_id) REFERENCES uais_lesson_versions(id, lesson_id) ON DELETE RESTRICT;
CREATE INDEX uais_assessments_lesson_version_idx ON uais_assessments(lesson_version_id) WHERE lesson_version_id IS NOT NULL;

CREATE FUNCTION uais_protect_published_lesson_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published lesson versions are immutable; create a new version';
END;
$$;
CREATE TRIGGER uais_lesson_version_immutable BEFORE UPDATE ON uais_lesson_versions
  FOR EACH ROW EXECUTE FUNCTION uais_protect_published_lesson_version();
