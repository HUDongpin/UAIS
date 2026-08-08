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

- `active-production`: core auth, managed Postgres, LRS, Sentry, and uptime
  variables that may be part of a production POC deployment after S19/S22
  approval.
- `optional-live-ai`: DeepSeek, DashScope/Qwen, AI access, and live-AI spend
  guard variables. The provider credentials stay blocked until the owner approves
  live provider use, cost, and rate-limit risk for a specific task. The
  `UAIS_LEARNING_CHATROOM_RATE_LIMIT_*` names are the exception: they tune a
  guard that is already enforced with safe defaults when they are unset, so
  leaving them unconfigured is safe and setting the mode to `off` is not. The
  reserved group-chatroom names below also sit in this tier.
- `quarantined-legacy`: older teacher-auth split, external storage, ordinary
  teaching provider, and enterprise evidence-gate variables, plus the local JSON
  data-directory paths that only apply outside production. They are retained for
  historical scripts/tests and local/test persistence, but are not required for
  the core POC production surface.

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
