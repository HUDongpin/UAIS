# 2026-06-29 S11 Enterprise Closed-Loop Regression Guards

Session: S11 regression quality and release readiness

## Objective

Add a compact regression guard for the enterprise run-through so previously closed gaps do not silently regress while S12/S22 continue hardening backend and production evidence flows.

## Changes

- Added `tests/enterprise-closed-loop-regression.test.ts`.
- Locked ordinary teaching operations against the original high-risk regression:
  - no default `teacher-kang` actor inside `/api/teaching/operations`;
  - signed teacher auth before request body parsing;
  - course ownership before operation persistence;
  - production persistence requires external storage.
- Locked the main `/teaching` workspace against local-only success regressions:
  - inline actions POST to `/api/teaching/operations`;
  - idempotency keys, audit readback, domain persistence failure handling, and server-save failure copy remain wired.
- Locked course-cover generation against asset-binding regressions:
  - signed teacher and course access gates remain before Qwen generation;
  - generated cover assets persist to the course asset store;
  - existing-course cover binding remains wired to course management records.
- Locked AI workflow API direct access:
  - contract/live POST routes and generated PPT narration download/export routes require signed AI access;
  - admin readiness/audit routes require signed admin AI access.
- Locked production release evidence:
  - teacher workflow live generation must prove `live-provider-approved` remote mutation and cannot satisfy the gate with `fixture-blocked` provider generation.

## Checks

- `npm run test -- tests/enterprise-closed-loop-regression.test.ts`: passed, 5 passed.
- `npm run test -- tests/enterprise-closed-loop-regression.test.ts tests/teaching-operation-backend.test.ts tests/teaching-course-cover-api.test.ts tests/ai-api-routes.test.ts tests/production-release-gate.test.ts`: passed, 677 passed across 5 files.
- `npm run test`: passed, 1483 passed across 72 files. The suite emitted existing jsdom `Not implemented: navigation to another Document` notices without failing.
- `npm run lint`: passed.
- `npm run build`: passed.

## Not Run

- Live production smoke tests and remote provider mutations were not run. This slice adds local regression coverage only and does not use live credentials or mutate production state.

## Handoff

This guard is intentionally small and source-oriented. It complements the deeper route and release-gate tests by preventing the original enterprise closed-loop gaps from reappearing through future refactors.

No Git staging, commit, branch, push, reset, deletion, or revert was performed.
