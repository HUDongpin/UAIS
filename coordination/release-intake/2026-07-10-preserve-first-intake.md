# UAIS Preserve-First Release Intake — 2026-07-10

## Scope

- Owner-authorized local integration of the completed S04, S07, S12/S19, and S24 slices into reviewable commits on `main`.
- Confirm the recovery worktree has no unique implementation before removing it.
- Do not push, expose secrets, stage ignored files, or use broad staging commands.

## Intake State

- Intake time: `2026-07-10 17:42:55 HKT`.
- Root: `/Users/dongpinhu/Desktop/UAIS`.
- Branch and base: `main` at `04bc997da4618b13a83a351aa22e7e4220727b27`.
- Dirty map: 20 entries — 14 modified tracked files and 6 untracked session logs.
- `git diff --check`: passed before staging.
- No pre-existing stashes.
- No committed branch was ahead of or unmerged into `main`.

## Preserve-First Snapshot

- Full tracked and untracked snapshot: Git stash object `3f1cf80171b15f35732b7df531e571fddd3683aa`.
- Label: `S25 preserve-first pre-split snapshot 2026-07-10`.
- The snapshot excludes ignored local files, so `.env*`, `.vercel`, generated output, dependencies, and credential documents were not captured or staged.
- The snapshot was applied back without conflict before slicing; it remains available as a rollback point.

## Planned Review Slices

1. S04 — AI-guide pending/failure transcript and layout behavior.
2. S07 — Qwen Omni streaming client and provider-smoke alignment.
3. S12/S19 — guarded Production demo authentication, Proxy navigation, environment/deployment handoff.
4. S24 — Kang Xia published-PPT access, accurate playback errors, and regression coverage.
5. S25 — this intake, commit map, verification, and worktree-cleanup evidence.

## Worktree Intake

- Active recovery worktree: `/Users/dongpinhu/Desktop/UAIS-worktrees/recovery-compose-2026-07-10`.
- Branch: `codex/uais-recovery-compose-2026-07-10` at the same base `04bc997` as the root.
- Dirty state: four modified implementation/test files and one untracked S24 log.
- Two `/private/tmp/uais-clean-proof-*` registrations are prunable because their directories no longer exist.

## Final Evidence

- Reviewable commit map:
  1. `a025eab` — `fix(learning): preserve AI guide questions on failure` (S04).
  2. `e3f6b2d` — `fix(ai): support Qwen Omni streaming` (S07).
  3. `49f0db3` — `fix(auth): restore guarded production demo access` (S12/S19).
  4. `590fc8e` — `fix(learning): restore Kang Xia PPT playback` (S24).
  5. S25 release-intake evidence and S22 deployment handoff are committed separately after this report is finalized.
- Targeted verification before each implementation commit:
  - S04 learning page: 23/23 tests passed.
  - S07 provider/smoke: 75/75 tests passed.
  - S12/S19 authentication and course readback: 86/86 tests passed.
  - S24 learning page and PPT API: 41/41 tests passed.
- Recovery-worktree comparison:
  - The old branch was an ancestor of `main` and had no unique commits.
  - Its access-denial UI and local Kang Xia playback regression are present in `main`.
  - `main` supersedes its local-only playback path with explicit Production opt-in, Production-without-opt-in denial, and deployed-preview denial coverage.
  - The old worktree's five dirty paths were preserved in stash `d458bfa209acee7e13f33d513ad3616276330d32` before cleanup.
- Cleanup:
  - Removed `/Users/dongpinhu/Desktop/UAIS-worktrees/recovery-compose-2026-07-10` after it was clean and backed up.
  - Safely deleted redundant branch `codex/uais-recovery-compose-2026-07-10` at ancestor `04bc997`.
  - Pruned both missing `/private/tmp/uais-clean-proof-*` registrations.
  - `git worktree list --porcelain` now contains only `/Users/dongpinhu/Desktop/UAIS` on `main`.
- Final verification:
  - `npm run test`: 159 files and 1,992 tests passed.
  - `npm run lint`: passed.
  - `NEXT_TELEMETRY_DISABLED=1 npm run build`: passed; Next.js 16.2.9 compiled, TypeScript passed, and 23/23 static-generation units completed.
  - `npm run release:clean-check`: passed.
  - `git diff --check HEAD~5..HEAD`: passed.
  - `git branch --no-merged main`: empty.
  - Changed-path secret-like artifact check found no `.env*`, `.vercel`, or `All API Keys.docx` path in the five-commit range.
  - Final root status contained only `## main`.
  - The two preserve-first stashes remain reachable by object ID.
