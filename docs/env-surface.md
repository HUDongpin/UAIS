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
- `optional-live-ai`: DeepSeek, DashScope/Qwen, and AI access variables. These
  stay blocked until the owner approves live provider use, cost, and rate-limit
  risk for a specific task.
- `quarantined-legacy`: older teacher-auth split, external storage, ordinary
  teaching provider, and enterprise evidence-gate variables. They are retained
  for historical scripts/tests but are not required for the core POC production
  surface.

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
