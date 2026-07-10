# UAIS Core Schema Design

Status: B-10 reviewed schema draft plus B-11 first migration baseline.
Created: 2026-07-08.

This file expands the architecture map's minimal data model into a durable
schema contract. The checked-in implementation now uses provider-neutral
Postgres SQL and Drizzle table definitions, without choosing Neon, Supabase,
Vercel Postgres, or another hosted provider. That provider choice belongs to the
owner/S12/S22 deployment package.

## Design Principles

- Use one durable database as the system of record for core product state.
- Keep local JSON stores and external-storage experiments behind adapters until
  they are retired by expand, migrate, contract.
- Keep LLM output and analytics summaries out of the system-of-record role.
- Store the minimum student PII needed and follow `docs/privacy-baseline.md`.
- Use stable ids for joins and audit records; avoid free-text identity fields
  where an internal id is enough.
- Add API validation at route boundaries before writes reach storage.

## Core Entities

### `users`

Purpose: one account record per person or service actor.

Suggested fields:

- `id`: uuid primary key.
- `account`: unique login/account handle.
- `hashed_password`: nullable when an external auth provider owns the secret.
- `role`: enum `student`, `teacher`, `admin`.
- `display_name`: user-visible name.
- `department`: optional affiliation.
- `status`: enum `active`, `disabled`, `invited`.
- `created_at`, `updated_at`.

Invariants:

- Demo credentials must not be production users.
- `admin` is least-privilege and audited; it is not the default role.
- Password hashes or provider subject ids are server-only.

### `courses`

Purpose: course-level teaching container.

Suggested fields:

- `id`: uuid primary key.
- `slug`: unique stable route/import key.
- `title`: localized or canonical title.
- `description`: optional summary.
- `teacher_id`: foreign key to `users.id`.
- `status`: enum `draft`, `published`, `archived`.
- `created_at`, `updated_at`.

Invariants:

- Only the owning teacher or approved admin path can mutate a course.
- Public course metadata must not imply access to protected records.

### `lessons`

Purpose: ordered learning units within a course.

Suggested fields:

- `id`: uuid primary key.
- `course_id`: foreign key to `courses.id`.
- `title`.
- `position`: integer order within course.
- `content_ref`: reference to approved content or asset metadata.
- `created_at`, `updated_at`.

Invariants:

- Lesson order is unique per course.
- Raw private files should live in approved storage, not in the database row.

### `classes`

Purpose: concrete teaching cohort for a course.

Suggested fields:

- `id`: uuid primary key.
- `course_id`: foreign key to `courses.id`.
- `teacher_id`: foreign key to `users.id`.
- `name`.
- `status`: enum `open`, `closed`, `archived`.
- `created_at`, `updated_at`.

Invariants:

- A class belongs to one course.
- Teacher access is scoped by the class's owning teacher/course.

### `invite_codes`

Purpose: controlled student enrollment path.

Suggested fields:

- `id`: uuid primary key.
- `class_id`: foreign key to `classes.id`.
- `code_hash`: hashed invite code.
- `status`: enum `active`, `revoked`, `expired`.
- `expires_at`: nullable timestamp.
- `created_at`, `updated_at`.

Invariants:

- Store a hash, not the raw invite code, when the code is reusable.
- Join attempts must resolve to active class/course scope before enrollment.

### `enrollments`

Purpose: membership state linking a learner to a class/course.

Suggested fields:

- `id`: uuid primary key.
- `user_id`: foreign key to `users.id`.
- `course_id`: foreign key to `courses.id`.
- `class_id`: foreign key to `classes.id`.
- `state`: enum `pending`, `active`, `rejected`, `withdrawn`, `completed`.
- `progress`: numeric percentage or structured progress snapshot.
- `created_at`, `updated_at`.

Invariants:

- One active enrollment per user/course/class.
- A student can read only their own enrollment unless teacher/admin scope is
  proven.

### `assessments`

Purpose: teacher-authored assessment definitions.

Suggested fields:

- `id`: uuid primary key.
- `lesson_id`: foreign key to `lessons.id`.
- `type`: enum `quiz`, `assignment`, `discussion`, `manual`.
- `title`.
- `rubric_ref`: optional external or structured rubric reference.
- `created_at`, `updated_at`.

Invariants:

- Assessment definitions are teacher-owned through the course/class chain.
- Scoring rules should be reviewable without calling an AI provider.

### `submissions`

Purpose: learner work and teacher feedback metadata.

Suggested fields:

- `id`: uuid primary key.
- `assessment_id`: foreign key to `assessments.id`.
- `user_id`: foreign key to `users.id`.
- `state`: enum `draft`, `submitted`, `reviewed`, `returned`.
- `score`: nullable numeric value.
- `content_ref`: optional reference to protected submission content.
- `submitted_at`, `reviewed_at`, `created_at`, `updated_at`.

Invariants:

- Students see only their own submissions.
- Teachers see submissions only for owned course/class scope.
- AI feedback is advisory metadata, not the authoritative grade.

### `learning_events`

Purpose: xAPI-shaped raw learning signal.

Suggested fields:

- `id`: uuid primary key.
- `user_id`: foreign key to `users.id`.
- `course_id`: foreign key to `courses.id`.
- `class_id`: optional foreign key to `classes.id`.
- `verb`: canonical xAPI-style verb.
- `object`: canonical object id or structured reference.
- `context`: minimal JSON context.
- `occurred_at`: timestamp.
- `created_at`.

Invariants:

- Events are append-oriented; corrections should be new events or audited
  status changes.
- Learner analytics must enforce self-scope, teacher class/course scope, or
  signed admin scope with audit reason.

### `learner_profiles`

Purpose: derived learner state used by adaptive features.

Suggested fields:

- `user_id`: primary and foreign key to `users.id`.
- `course_id`: foreign key to `courses.id`.
- `mastery`: JSON summary generated from deterministic rules.
- `preferences`: JSON learner preferences.
- `updated_at`.

Invariants:

- This is derived state and must be reproducible from stored records where
  practical.
- Do not store sensitive free text unless the teaching purpose is documented.

### `recommendations`

Purpose: reproducible next-step suggestions.

Suggested fields:

- `id`: uuid primary key.
- `user_id`: foreign key to `users.id`.
- `course_id`: foreign key to `courses.id`.
- `next_lesson_id`: nullable foreign key to `lessons.id`.
- `rationale`: short deterministic rationale.
- `source_event_id`: nullable foreign key to `learning_events.id`.
- `created_at`.

Invariants:

- Recommendations must be reproducible from persisted learner state and rules.
- LLM text may explain a recommendation, but the selected next step should come
  from deterministic service logic.

## Cross-Cutting Tables To Add With The First DB Adapter

- `audit_log`: actor id, action, target type/id, trace id, audit reason when
  applicable, redacted metadata, timestamp.
- `export_jobs`: initiator id, scope, manifest id, status, retention/delete-by
  timestamp, created_at.
- `provider_jobs`: provider type, internal job id, status, redacted metadata,
  retention/delete-by timestamp, created_at.

These tables support release safety, privacy, and incident response. They must
not store provider secrets, raw cookies, local paths, or raw student content.

## Implemented Baseline

- Drizzle schema: `src/lib/db/schema.ts`.
- Redacted readiness helper: `src/lib/db/core-database.ts`.
- Transitional teaching-course repository:
  `src/lib/server/teaching-course-management-postgres-store.ts`.
- Migration manifest: `src/lib/db/migrations.ts`.
- SQL migration: `migrations/0001_core_poc.sql`.
- Migration runner: `npm run db:migrate`.
- Vercel build gate: `npm run vercel-build` applies migrations before `next build`.
- Production LangGraph persistence: official `PostgresSaver` and
  `PostgresStore` in the isolated `uais_langgraph` schema.

The migration runner requires `UAIS_CORE_DATABASE_URL`, `DATABASE_URL`, or
`POSTGRES_URL`. The teaching-course route selects the managed adapter with
`UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=postgres`; production LangGraph uses
the same database with `UAIS_LANGGRAPH_PERSISTENCE_BACKEND=postgres`. The
runner also applies the official LangGraph checkpointer/store migrations.

## Migration Order

1. Apply `migrations/0001_core_poc.sql` in a dedicated staging database.
2. Seed reviewed non-secret demo data.
3. Prove the transitional teaching-course Postgres repository in staging.
4. Backfill from reviewed non-secret seed data.
5. Dual-write or migrate teaching course/class/member operations into the
   normalized tables after staging parity is proven.
6. Validate lessons, assessments, submissions, learning events, learner
   profiles, and recommendations against the current route behavior.
7. Switch reads after parity is proven in staging.
8. Remove the old JSON/file path only after rollback is documented and tested.

## Review Questions

- Which managed Postgres provider will host the first staging database?
- What retention windows should be encoded for exports, provider jobs, learning
  events, submissions, and backups?
- Should tenant-level admin analytics exist in the product, or remain a
  break-glass operational route?
- Which seed data is allowed to enter the durable store for the first pilot?
