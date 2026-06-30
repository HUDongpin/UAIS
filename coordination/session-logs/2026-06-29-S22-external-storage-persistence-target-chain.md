# 2026-06-29 S22 External Storage Persistence Target Chain

## Session

- Session ID: S22
- Role: Production reliability and release engineering
- Objective: Keep the external-storage persistence production evidence target consistent from generator output through service readiness and the production release gate.

## Summary

Closed a production evidence-chain mismatch around the external-storage persistence target. The canonical enterprise audit target is now `external-storage-persistence`; the persistence smoke emits that target, the external-storage service readiness script only accepts that target, and the production release gate requires that target before satisfying storage readiness.

## Changes

- Updated the production release gate to require external-storage service readiness `persistenceEvidence.target === "external-storage-persistence"` with matched status, redaction, and release-run binding.
- Added a release-gate negative test proving stale `external-storage-persistence-smoke` target evidence is blocked even when status is otherwise `matched`.
- Updated external-storage service readiness to require canonical persistence evidence target `external-storage-persistence`.
- Added a readiness negative test proving stale persistence target artifacts are rejected before health evidence can be reused.
- Updated readiness prerequisite copy from `external-storage-persistence-smoke` to `external-storage-persistence`.

## Files Changed

- `scripts/external-storage-persistence-smoke.mjs`
- `scripts/external-storage-service-readiness.mjs`
- `scripts/production-e2e-release-gate.mjs`
- `tests/enterprise-live-evidence-audit.test.ts`
- `tests/external-storage-persistence-smoke.test.ts`
- `tests/external-storage-service-readiness.test.ts`
- `tests/production-release-gate.test.ts`
- `coordination/session-logs/2026-06-29-S22-external-storage-persistence-target-chain.md`

## Checks

- Passed: `npm run test -- tests/production-release-gate.test.ts -t "wrong target"`
- Passed: `npm run test -- tests/production-release-gate.test.ts`
- Passed: `npm run test -- tests/external-storage-service-readiness.test.ts -t "artifact target is stale"`
- Passed: `npm run test -- tests/external-storage-service-readiness.test.ts`
- Passed: `npm run test -- tests/enterprise-live-evidence-audit.test.ts tests/production-e2e-orchestrator.test.ts tests/enterprise-live-acceptance-packet.test.ts tests/enterprise-runthrough-live-proof-runbook.test.ts tests/production-release-gate.test.ts tests/external-storage-persistence-smoke.test.ts tests/external-storage-service-readiness.test.ts`
- Passed: `npm run test` (71 files, 1467 tests)
- Passed: `npm run lint`
- Passed: `npm run build`

## Not Run

- Not run: owner-approved production external-storage write/read proof.
- Not run: production-live smoke against remote services.
- Not run: Vercel deployment mutation.

## Remaining Risk

- The contract now blocks stale local evidence, but enterprise completion still requires a fresh same-run production-live evidence packet with remote HTTPS external storage, canonical `external-storage-persistence`, and all audit-required targets accepted.
- The repository remains a large dirty parallel worktree; no staging, commit, branch, push, reset, or revert was performed.
