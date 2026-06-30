# 2026-06-29 S22 Enterprise Live Audit Filename Target Binding

## Session

- Session ID: S22
- Role: Production reliability and release engineering
- Objective: Bind production-live evidence file identity to its JSON body target in the enterprise release evidence chain.

## Summary

Hardened enterprise live evidence verification so a production-live artifact must prove the same target in both the filename and JSON body. This prevents a valid body for one canonical target from being placed under another target's evidence filename and still being accepted as part of a complete production evidence packet.

## Changes

- `scripts/enterprise-live-evidence-audit.mjs`
  - Derives `filenameTarget` from each `YYYY-MM-DD-*-production-live.json` filename.
  - Preserves the existing `route-smoke` filename alias for canonical `deployment-route-smoke`.
  - Adds `target-filename-mismatch` to row blockers when filename and body targets differ.
  - Emits `filenameTarget` in audit rows for redacted reviewability.
- `scripts/production-e2e-release-gate.mjs`
  - Independently derives each audit row's target from the row filename.
  - Rejects fabricated or stale ready audit rows when filename and body targets differ.
- `tests/enterprise-live-evidence-audit.test.ts`
  - Adds a red/green test for swapped filename/body targets across otherwise valid production-live evidence.
- `tests/production-release-gate.test.ts`
  - Adds a red/green test for a fabricated ready audit with swapped filename/body targets.

## Checks

- Passed: `npm run test -- tests/enterprise-live-evidence-audit.test.ts -t "filename and body targets differ"`
- Passed: `npm run test -- tests/enterprise-live-evidence-audit.test.ts`
- Passed: `npm run test -- tests/production-release-gate.test.ts -t "row filenames contradict body targets"`
- Passed: `npm run test -- tests/production-release-gate.test.ts`
- Passed: `npm run test -- tests/enterprise-live-evidence-audit.test.ts tests/production-e2e-orchestrator.test.ts tests/enterprise-live-acceptance-packet.test.ts tests/enterprise-runthrough-live-proof-runbook.test.ts tests/production-release-gate.test.ts tests/external-storage-persistence-smoke.test.ts tests/external-storage-service-readiness.test.ts`
- Passed: `npm run test` (71 files, 1471 tests)
- Passed: `npm run lint`
- Passed: `npm run build`

## Not Run

- Not run: owner-approved production live smoke.
- Not run: remote storage, provider, or Vercel mutation.

## Remaining Risk

- This strengthens local and gate-level evidence integrity, but enterprise completion still requires fresh same-run production-live artifacts for all canonical targets from real approved production smokes.
- The worktree remains a large dirty parallel checkout; no Git mutation was performed.
