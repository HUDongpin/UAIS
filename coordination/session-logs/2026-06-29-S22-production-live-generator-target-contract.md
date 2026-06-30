# 2026-06-29 S22 Production Live Generator Target Contract

## Session

- Session ID: S22
- Role: Production reliability and release engineering
- Objective: Keep production-live evidence generators aligned with the enterprise audit target source of truth.

## Summary

Closed a release-gate contract gap where the external storage persistence live evidence script emitted `external-storage-persistence-smoke`, while the enterprise audit and orchestrator require the canonical target `external-storage-persistence`.

## Changes

- Tightened the enterprise live evidence audit test so every production-live evidence generator must declare its mapped audit target literal, not only the shared safety flags.
- Updated `scripts/external-storage-persistence-smoke.mjs` to emit `target: "external-storage-persistence"`.
- Updated `tests/external-storage-persistence-smoke.test.ts` expectations to the canonical target name.

## Files Changed

- `scripts/external-storage-persistence-smoke.mjs`
- `tests/enterprise-live-evidence-audit.test.ts`
- `tests/external-storage-persistence-smoke.test.ts`
- `coordination/session-logs/2026-06-29-S22-production-live-generator-target-contract.md`

## Checks

- Passed: `npm run test -- tests/enterprise-live-evidence-audit.test.ts -t "production-live evidence generators"`
- Passed: `npm run test -- tests/external-storage-persistence-smoke.test.ts`
- Passed: `npm run test -- tests/enterprise-live-evidence-audit.test.ts tests/production-e2e-orchestrator.test.ts tests/enterprise-live-acceptance-packet.test.ts tests/enterprise-runthrough-live-proof-runbook.test.ts tests/production-release-gate.test.ts tests/external-storage-persistence-smoke.test.ts`
- Passed: `npm run test` (71 files, 1465 tests)
- Passed: `npm run lint`
- Passed: `npm run build`

## Not Run

- Not run: production live smoke against remote services.
- Not run: remote mutation or approved external storage write/read proof.

## Remaining Risk

- The local contract is now aligned, but enterprise completion still depends on a fresh approved production-live evidence packet that includes all required audit targets, including the canonical `external-storage-persistence` entry.
- The repository remains a large dirty parallel worktree; no Git mutation was performed.
