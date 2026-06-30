# S22 Release Gate Enterprise Target Source-of-Truth Supplement

## Summary

- Found that `scripts/production-e2e-release-gate.mjs` still maintained a separate hard-coded `requiredEnterpriseLiveEvidenceAuditTargets` list after the audit, orchestrator tests, packet, and runbook had been aligned to the audit script.
- Added a failing regression requiring the final release gate to read enterprise live required targets from `scripts/enterprise-live-evidence-audit.mjs`.
- Updated the release gate to parse `requiredEnterpriseLiveEvidenceTargets` from the audit script at runtime and use that list for required target details and missing-target checks.
- Updated release-gate and orchestrator tests so they validate the new source-of-truth relationship instead of parsing an obsolete duplicate array from the gate.

## Files Changed

- `scripts/production-e2e-release-gate.mjs`
- `tests/production-release-gate.test.ts`
- `tests/production-e2e-orchestrator.test.ts`
- `coordination/session-logs/2026-06-29-S22.md`
- `coordination/session-logs/2026-06-29-S22-release-gate-source-of-truth.md`

## Checks Run

- `npm run test -- tests/production-release-gate.test.ts -t "reads enterprise live required targets"`: failed before implementation because the release gate did not reference `enterprise-live-evidence-audit.mjs`, then passed after implementation.
- `npm run test -- tests/production-release-gate.test.ts -t "enterprise-live|production-live audit|body-level production-live audit|audit-level cookie"`: passed with 6 matched tests.
- `npm run test -- tests/enterprise-live-evidence-audit.test.ts tests/production-e2e-orchestrator.test.ts tests/enterprise-live-acceptance-packet.test.ts tests/enterprise-runthrough-live-proof-runbook.test.ts tests/production-release-gate.test.ts`: failed before updating the orchestrator regression because it still parsed the old gate-local target array, then passed with 338 tests across 5 files.
- `npm run test`: passed with 1463 tests across 71 files.
- `npm run lint`: passed.
- `npm run build`: passed.

## Checks Not Run

- No live production smoke was executed and no remote mutation was performed.

## Risks

- The final release gate now shares the audit script's target source-of-truth, but this remains an offline contract improvement. Enterprise acceptance still requires owner-approved same-run live production evidence for every required target.

## Coordination Notes

- S22 changed release gate script/tests and session logging only. No credentials, environment files, live deployment, external storage, or provider calls were touched.
