-- UAIS B-11 core POC managed Postgres baseline.
-- Provider-neutral Postgres SQL for Neon, Supabase, Vercel Postgres, or a
-- standard managed Postgres instance.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS uais_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account text NOT NULL UNIQUE,
  password_hash text,
  role text NOT NULL CHECK (role IN ('student', 'teacher', 'admin')),
  display_name text NOT NULL,
  department text,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('active', 'disabled', 'invited')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (password_hash IS NULL OR length(password_hash) >= 20)
);

CREATE TABLE IF NOT EXISTS uais_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  teacher_id uuid NOT NULL REFERENCES uais_users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uais_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES uais_courses(id) ON DELETE CASCADE,
  title text NOT NULL,
  position integer NOT NULL CHECK (position > 0),
  content_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, position)
);

CREATE TABLE IF NOT EXISTS uais_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES uais_courses(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES uais_users(id) ON DELETE RESTRICT,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uais_invite_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES uais_classes(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, code_hash)
);

CREATE TABLE IF NOT EXISTS uais_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES uais_users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES uais_courses(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES uais_classes(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'active', 'rejected', 'withdrawn', 'completed')),
  progress numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id, class_id)
);

CREATE TABLE IF NOT EXISTS uais_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES uais_lessons(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('quiz', 'assignment', 'discussion', 'manual')),
  title text NOT NULL,
  rubric_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uais_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES uais_assessments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES uais_users(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'submitted', 'reviewed', 'returned')),
  score numeric(5,2) CHECK (score IS NULL OR (score >= 0 AND score <= 100)),
  content_ref text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uais_learning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES uais_users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES uais_courses(id) ON DELETE CASCADE,
  class_id uuid REFERENCES uais_classes(id) ON DELETE SET NULL,
  verb text NOT NULL,
  object_id text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uais_learner_profiles (
  user_id uuid NOT NULL REFERENCES uais_users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES uais_courses(id) ON DELETE CASCADE,
  mastery jsonb NOT NULL DEFAULT '{}'::jsonb,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id)
);

CREATE TABLE IF NOT EXISTS uais_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES uais_users(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES uais_courses(id) ON DELETE CASCADE,
  next_lesson_id uuid REFERENCES uais_lessons(id) ON DELETE SET NULL,
  rationale text NOT NULL,
  source_event_id uuid REFERENCES uais_learning_events(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uais_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES uais_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  trace_id text,
  audit_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uais_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_id uuid REFERENCES uais_users(id) ON DELETE SET NULL,
  scope text NOT NULL,
  manifest_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'ready', 'failed', 'deleted')),
  delete_by timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uais_provider_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_type text NOT NULL,
  provider_job_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'deleted')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  delete_by timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_type, provider_job_id)
);

CREATE TABLE IF NOT EXISTS uais_teaching_course_management_snapshots (
  snapshot_key text PRIMARY KEY,
  database jsonb NOT NULL,
  revision text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS uais_courses_teacher_id_idx ON uais_courses(teacher_id);
CREATE INDEX IF NOT EXISTS uais_lessons_course_id_idx ON uais_lessons(course_id);
CREATE INDEX IF NOT EXISTS uais_classes_course_teacher_idx ON uais_classes(course_id, teacher_id);
CREATE INDEX IF NOT EXISTS uais_invite_codes_class_status_idx ON uais_invite_codes(class_id, status);
CREATE INDEX IF NOT EXISTS uais_enrollments_user_idx ON uais_enrollments(user_id);
CREATE INDEX IF NOT EXISTS uais_enrollments_course_class_idx ON uais_enrollments(course_id, class_id);
CREATE INDEX IF NOT EXISTS uais_submissions_user_idx ON uais_submissions(user_id);
CREATE INDEX IF NOT EXISTS uais_learning_events_user_course_time_idx ON uais_learning_events(user_id, course_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS uais_learning_events_course_verb_time_idx ON uais_learning_events(course_id, verb, occurred_at DESC);
CREATE INDEX IF NOT EXISTS uais_recommendations_user_course_time_idx ON uais_recommendations(user_id, course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS uais_audit_log_target_idx ON uais_audit_log(target_type, target_id, created_at DESC);
