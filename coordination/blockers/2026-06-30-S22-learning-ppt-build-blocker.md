# S22 Build Blocker: Learning PPT Playback Access Union

## Summary

`npm run build` originally failed in `src/app/api/learning/ppt-playback/[courseId]/route.ts` during TypeScript checking. The failing line read `input.access.classId` while the authorized access union also included a teacher ownership branch that does not define `classId`. See the resolution section below for the S12 fix and passing checks.

## Evidence

- Command: `npm run build`
- Status: failed during TypeScript checking.
- Error location: `src/app/api/learning/ppt-playback/[courseId]/route.ts:166`
- Error: `Property 'classId' does not exist on type ... teacher-course-ownership-approved ...`

## Scope

- This is outside the current S22 release-gate evidence hardening slice.
- Likely owning boundary: S12 API access contract and/or S03 learning playback behavior.

## Recommended Fix Direction

- Narrow the authorized access union before recording the learning event context.
- For teacher-authorized playback, either omit `classId` from the learning record context or supply a teacher-safe contextual value through an explicit contract.

## Checks Already Passing Before This Blocker

- `node --check scripts/production-e2e-release-gate.mjs`: passed.
- `npm run test -- tests/production-release-gate.test.ts --reporter=dot`: passed, 389 tests.
- `npm run test -- tests/enterprise-live-evidence-audit.test.ts tests/production-release-gate.test.ts tests/enterprise-live-acceptance-packet.test.ts tests/enterprise-closed-loop-regression.test.ts --reporter=dot`: passed, 458 tests.
- `npm run test -- --reporter=dot`: passed, 72 files and 1664 tests.
- `npm run lint`: passed.

## S22 Stop Condition

S22 did not edit the learning playback API route because feature/API route fixes in `src/` are outside this S22 evidence-gate hardening scope unless explicitly assigned.

## Resolution

Status: resolved by S12 continuation slice on 2026-06-30.

The API route now narrows the playback-view recorder input to the student-authorized access branch before reading `classId`. Teacher-owned preview access remains valid, but it does not flow into the student learning-event recorder.

## Resolution Evidence

- `npm run test -- tests/learning-ppt-playback-api.test.ts --reporter=dot`: passed, 14 tests.
- `npm run test -- --reporter=dot`: passed, 72 files and 1664 tests. Vitest printed existing jsdom navigation and React `act(...)` warnings, but no test failed.
- `npm run lint`: passed.
- `npm run build`: passed.

## Remaining Release Boundary

This blocker no longer prevents local build verification. The broader enterprise release gate still remains blocked until fresh owner-approved live production smoke evidence replaces dry-run/template/fixture-blocked evidence.
