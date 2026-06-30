# S25 Release Intake Operating Plan

- Date: 2026-06-19
- Prepared by: S10
- Intended owner: S25
- Status: Ready for next S25 intake pass
- Decision: Do not add S26+ roles for the current UAIS workload. Use tighter release intake and smaller S22/S11/S19/S12/S24 packages instead.

## Why This Exists

Current UAIS pressure is concentrated in release evidence, Vercel/project readiness, external storage, teacher auth, and PPT/manual acceptance. The project already has roles for those areas. The immediate risk is coordination overload, stale evidence, and unclear dirty-tree ownership, not missing headcount.

## Required S25 First Pass

S25 should create `coordination/release-intake/YYYY-MM-DD-dirty-tree-inventory.md` with:

- Current `git status --short` summary.
- File ownership map by session, using `AGENTS.md`.
- Changed-file categories: feature UI, backend/API, release scripts, tests, docs/coordination, generated/local-only, and secret-like local artifacts.
- Conflict risks where two sessions appear to touch the same shared file.
- Current canonical evidence files for release gate, owner decision checklist, local-production proof, Vercel readiness, external-storage readiness, teacher-auth readiness, deployed smokes, and PPT/manual acceptance.
- Stale or superseded evidence files that should not be used for release claims.
- Recommended PR/commit slices, without staging or committing.

Secret-like paths must be redacted by category. Do not inspect or quote credential values.

## S22 Package Slicing Rule

Each S22 assignment should cover only one release-chain segment:

- Vercel project/team/link readiness.
- Env apply preflight evidence binding, with S19 as the env owner.
- Production deployment evidence.
- Deployed `/teaching` page smoke.
- Deployed teacher workflow browser smoke.
- Protected production route smoke.
- External-storage service readiness or write/read smoke.
- Aggregate release-gate refresh after upstream evidence changes.

If one segment reveals a backend/API contract gap, hand off to S12. If it reveals env placement or provider parity, hand off to S19. If it reveals PPT/export acceptance evidence, hand off to S24. If it reveals regression-matrix ambiguity, hand off to S11.

## S10/S11/S25 Coordination Loop

- S25 inventories dirty tree and evidence freshness before broad release work starts.
- S10 turns S25 intake into nightly assignments and the president-report summary.
- S11 converts release-gate expectations into a readable QA/release matrix.
- S22 executes the next narrow release-engineering package only after the owner decisions and upstream evidence for that package are available.

## Stop Conditions

Stop and ask the owner before:

- Linking or creating a Vercel project.
- Applying or changing env vars.
- Running live production deployment or smoke commands that mutate external state.
- Touching real secret files or credential documents.
- Staging, committing, branching, pushing, deleting, resetting, or reverting.
- Adding permanent S26+ roles.

## Acceptance Criteria

This operating plan is in effect when:

- The next release-intake pass exists under `coordination/release-intake/`.
- The intake pass identifies current vs stale evidence.
- The next nightly assignment gives S22 one narrow package rather than a broad release-chain bundle.
- S10's president report uses S25's intake and distinguishes local proof, live production proof, blockers, and owner decisions.
