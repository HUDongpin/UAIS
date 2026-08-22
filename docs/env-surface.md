# UAIS Environment Surface

Status: B-21 env-surface shrink and quarantine map.
Created: 2026-07-08.

This document separates the environment variables needed for the core UAIS POC
from variables retained for historical release gates, future enterprise modules,
or optional live AI work. It does not contain real values and it does not inspect
`.env.local`.

## Source Of Truth

- Catalog: `src/lib/release/env-surface.ts`
- Test: `tests/env-surface.test.ts`
- Example template: `.env.local.example`

## Tiers

- `active-production`: core auth, managed Postgres, LRS, Sentry, uptime, and
  durable-storage variables that may be part of a production POC deployment after
  S19/S22 approval. Durable storage is not optional once group chatrooms are
  live - courses, chatroom transcripts and share links all refuse local JSON in a
  production runtime - but it needs no storage-specific configuration: a
  production runtime with `UAIS_CORE_DATABASE_URL` persists them on the managed
  Postgres by default. The storage trio
  (`UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND`, `UAIS_EXTERNAL_STORAGE_BASE_URL`,
  `UAIS_EXTERNAL_STORAGE_ACCESS_TOKEN`) left quarantine because it is now a
  supported production choice rather than a legacy name, and is required only
  when a deployment selects `external` instead. Verify either path with
  `npm run release:chatroom-readiness`.
- `optional-live-ai`: DeepSeek, DashScope/Qwen, AI access, and live-AI spend
  guard variables. The provider credentials stay blocked until the owner approves
  live provider use, cost, and rate-limit risk for a specific task. The
  `UAIS_LEARNING_CHATROOM_RATE_LIMIT_*` names are the exception: they tune a
  guard that is already enforced with safe defaults when they are unset, so
  leaving them unconfigured is safe and setting the mode to `off` is not. The
  reserved group-chatroom names below also sit in this tier.
- `quarantined-legacy`: the teacher-auth issuer/OIDC split, the remaining
  external-storage service-side names, the external-append teaching provider, and
  enterprise evidence-gate variables, plus the local JSON
  data-directory paths that only apply outside production. They are retained for
  historical scripts/tests and local/test persistence, but are not required for
  the core POC production surface.

## Launch Auth Selectors

The launch configuration authenticates against the managed Postgres the
deployment already requires, so it needs no external identity service:

- `UAIS_APP_AUTH_PROVIDER=database-accounts` — logins are checked against the
  `uais_users` rows. `UAIS_APP_AUTH_PROVIDER_URL` and
  `UAIS_APP_AUTH_PROVIDER_TOKEN` are read only by `trusted-account-provider` and
  are therefore conditional, not required — the same treatment the
  external-storage endpoint pair gets. Provisioning and password resets for those
  rows are `scripts/seed-uais-accounts.mjs` and
  `scripts/reset-uais-account-password.mjs`; see `docs/auth-contract.md`.
- `UAIS_APP_SESSION_SIGNING_SECRET` — at least 32 characters, the same floor the
  teacher session secret carries. A deployed runtime refuses a shorter value and
  mints no session at all, so this is a launch-blocking value rather than a
  best-effort one; a local runtime still accepts anything.
- `UAIS_TEACHER_AUTH_PROVIDER=database-account-cookie` — teacher sessions are
  minted at login for accounts already verified as `role = 'teacher'`. It needs
  `UAIS_TEACHER_AUTH_SESSION_SIGNING_SECRET` (at least 32 characters) and
  nothing else: no issuer URL, no second secret. Both names left quarantine
  because a deployment without them serves a teacher who can read the course
  list and then 401s on every write.
- `UAIS_APP_ALLOW_PRODUCTION_DEMO_AUTH` — must be unset in production. It is the
  only switch that lets the `local-demo` provider (the fallback for an unset
  `UAIS_APP_AUTH_PROVIDER`) mint sessions in a production runtime, which would
  put the repo's public demo accounts on the live site.
- `trusted-account-provider`, `trusted-cookie-issuer` and `oidc-jwks` stay
  supported and catalogued as future options; none of them has a deployed
  service today.

`UAIS_CORE_DATABASE_URL` is required in the BUILD environment as well as at
runtime: `npm run vercel-build` applies the migrations from there, and `/healthz`
reports `checks.migrations` as `behind` (503) for a deployment whose database
never received them.

## Durable Learning-Record Outbox

P1 learning events are committed to Postgres before an API success response and
then mirrored to the LRS by a protected outbox dispatcher. The dispatcher uses
`UAIS_LEARNING_RECORD_OUTBOX_SECRET`, a server-only value of at least 32
characters. It is required in a deployment that runs the P1 learning loop and
must never be placed in a `NEXT_PUBLIC_*` variable, request log, xAPI statement,
or evidence report. LRS credentials remain separate; pausing or failing the LRS
dispatcher does not roll back classroom submissions or feedback stored in
Postgres.

## Local JSON Data Directories

`UAIS_TEACHING_COURSES_DATA_DIR` and `UAIS_LEARNING_CHATROOM_TRANSCRIPTS_DATA_DIR`
are quarantined, not active-production, because every production runtime path
asserts external storage and answers 503 for local JSON persistence. They apply
to development, tests, and non-production lanes only:

- `UAIS_TEACHING_COURSES_DATA_DIR` defaults to
  `.tmp/uais-teaching-course-management-db` under the working directory.
- `UAIS_LEARNING_CHATROOM_TRANSCRIPTS_DATA_DIR` splits transcripts off the course
  records. When unset it falls back to `UAIS_TEACHING_COURSES_DATA_DIR`, and only
  then to `.tmp/uais-learning-chatroom-transcripts-db`.

Leave both unset in deployed lanes; a deployment that needs them is a signal that
external storage is not configured.

## Group-Chatroom Names

These `optional-live-ai` names belong to the group learning chatroom rollout
(see
`coordination/reports/2026-08-08-learning-chatroom-group-implementation-plan.md`,
decisions D6 and D9). As of 2026-08-08 all four are read by
`src/app/api/learning/chatroom/route.ts`:

- `UAIS_LEARNING_CHATROOM_GROUPS_MODE`: group-chatroom feature flag. Group
  rooms stay disabled (403 `feature-not-enabled` for `groupId` requests)
  unless this is explicitly `on`.
- `UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_MODE`: history-read (GET) guard
  switch, enforced unless set to `off`.
- `UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_PER_MINUTE`: default 30.
- `UAIS_LEARNING_CHATROOM_HISTORY_RATE_LIMIT_PER_DAY`: default 2000.

## P1 Teacher Feedback AI

`UAIS_LEARNING_FEEDBACK_AI_ENABLED` is a server-only, exact-`true` opt-in for
teacher-requested AI feedback drafts. It remains `false` or unset until the
owner and S19 approve a UAIS-specific provider credential source, cost/rate
limit boundary, and target environment. Enabling it also requires the existing
server-only `DEEPSEEK_API_KEY`; neither value is exposed to the browser or
recorded in evidence. When disabled or unavailable, teachers retain the full
manual feedback and decision path.

## Operating Rule

When a deployment package adds or changes an env name:

1. Add it to `src/lib/release/env-surface.ts`.
2. Put it in exactly one tier.
3. Document the owner, purpose, value kind, and whether it is server-only.
4. Keep real values out of Git, reports, screenshots, and chat.
5. Do not move a quarantined name into `active-production` without owner/S19/S22
   approval and a redacted deployment-lane evidence note.

## Production Stop Conditions

Stop the release if:

- A secret-like value appears in a public `NEXT_PUBLIC_*` name.
- `UAIS_CORE_DATABASE_URL` is missing in a deployment lane that claims B-11/B-12
  database readiness.
- A new env name is present in `.env.local.example` but missing from the B-21
  catalog.
- A quarantined legacy env name is required to pass the core POC flow without an
  owner-approved scope expansion.
- Sentry, uptime, or auth values are present in evidence with unredacted values.
