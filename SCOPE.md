# UAIS Core POC Scope

Status: B-07 core-scope declaration and experimental-boundary map.
Created: 2026-07-08.

This file defines the small product UAIS is allowed to harden first. It is the
counterweight to the historical enterprise evidence surface: core work should
protect the routes real students and teachers use, while parked modules remain
outside the critical-flow gate until the owner explicitly reopens them.

## Core Product Surface

The core UAIS POC is limited to:

- `/login` and `/api/auth/app-session`
- `/courses`
- `/learning`
- `/learning/chatroom`
- `/teaching`
- Core teaching course-management routes under `/api/teaching/courses`
- Invite-code join and teacher membership approval routes used by the enrolment
  journey
- Learning-record event and analytics routes needed for learner profiles and
  deterministic recommendations

The core gate is `npm run test:critical`. It covers the current stable slice of
login, forged-cookie rejection, enrolment, learning evidence, learner profile,
and teacher course CRUD. Browser E2E, live preview/staging smokes, and chat UI
send/export checks remain follow-up work after deployment lanes are available.

## Parked / Experimental Surface

The following areas are retained for historical work or future owner-approved
packages, but they are not part of the core POC gate:

- Voice clone and PPT narration modules under `src/lib/ai/voice` and
  `/api/ai/voice-*`
- Enterprise production evidence gates, owner-decision packets, release-run
  orchestrators, and restore-drill simulations under `scripts/`,
  `coordination/reports/`, and non-core `/api/external-storage/*` routes
- Split teacher-auth/OIDC issuer proof paths that remain behind legacy
  readiness checks while app-session auth is consolidated
- Optional live AI provider smoke and provider-cost exercises
- Historical production release bundles that require live Vercel secrets or
  owner approval

Parked code should not be expanded as part of core POC work. If a parked module
becomes necessary for a real user journey, open a scoped owner decision first
and add it to the core gate with explicit tests.

## Development Rules

1. Put new product work in the core surface only unless the owner expands scope.
2. Do not add new environment variables for parked modules.
3. Keep `npm run test:critical` free of enterprise evidence, owner-decision,
   live-provider, and restore-drill tests.
4. Keep docs and runbooks short enough for a one- or two-person team to follow.
5. Do not move or delete parked modules without a separate owner-approved
   refactor package and focused regression evidence.

## Completion Notes

This document establishes the B-07 scope boundary. It does not physically move
legacy modules into a new directory because doing that safely requires a
separate import-path migration and broader regression pass.
