# UAIS Dirty Worktree Recovery Design

- Date: 2026-07-10 HKT
- Session: S25
- Status: Approved in chat; written specification awaiting owner review
- Source checkout: `/Users/dongpinhu/Desktop/UAIS`
- Compose checkout: `/Users/dongpinhu/Desktop/UAIS-worktrees/recovery-compose-2026-07-10`
- Compose branch: `codex/uais-recovery-compose-2026-07-10`
- Compose base: `d28d8a6cb2e8efbdf29bf7515de2ae7e93d500a8`

## Purpose

Recover the current UAIS dirty integration inventory into reviewable, owner-scoped commits without losing work, mixing secret-like local files into Git, or mutating the original dirty root before the recovered branch is independently verified.

The design follows the isolation model described in Daniel Mackay's article, [Parallel Vibe Coding: Using Git Worktrees with Claude Code](https://www.dandoescode.com/blog/parallel-vibe-coding-with-git-worktrees): one branch per worktree, independent working directories, no shared stash workflow, and explicit integration after review.

Worktrees prevent future sessions from colliding, but they do not automatically separate an existing mixed dirty tree. UAIS therefore needs a recovery composition phase before adopting the normal worktree-per-task workflow.

## Approved Scope

### In scope

- Give all 116 current status paths an explicit disposition: 115 commit candidates and one local-generated quarantine path.
- Create and use one sibling compose worktree because local disk space is constrained.
- Assign every source path to an owner package.
- Transfer the source paths into the compose worktree with explicit manifests.
- Commit the recovery as small, dependency-ordered, owner-scoped commits.
- Prove source-to-compose content parity.
- Run package-specific checks and full repository gates.
- Prepare a reviewable compose branch for a later `main` update decision.

### Explicitly out of scope for this approval

- Cleaning, restoring, resetting, deleting, or switching the original dirty root.
- Updating or force-moving local `main`.
- Pruning stale worktree metadata.
- Adding a Git remote, pushing branches, or opening pull requests.
- Changing Vercel projects, deployments, aliases, domains, or environment values.
- Inspecting, copying, staging, or committing ignored/local-only or secret-like files.
- Feature changes beyond what is already present in the 115 commit-candidate source paths.

The original root cleanup and local `main` update require a separate owner approval after compose verification.

## Authoritative Starting State

The recovery baseline was refreshed immediately before this design was written:

- Source branch: `codex/uais-dirty-rescue-2026-06-30`.
- Source `HEAD`: `d28d8a6cb2e8`.
- Local `main`: `3737ef20660d`.
- `main` is an ancestor of the source branch; the source branch is 18 commits ahead.
- Committed delta from `main` to the source branch: 1,258 files.
- Dirty source inventory: 44 tracked modifications, 72 untracked files, 0 staged files.
- Commit-candidate inventory: 44 tracked modifications and 71 untracked files.
- Local-generated quarantine inventory: `docs/technical-advisory/.Rhistory`; do not inspect, hash, copy, stage, or commit it.
- Existing owner map coverage: 97 of 116 paths.
- Unmapped paths: 19.
- Git remotes: none.
- Stale linked-worktree records: two detached `/private/tmp/uais-clean-proof-*` entries, both currently prunable because their directories no longer exist.
- Available disk space at design time: approximately 20 GiB.
- Compose baseline: clean at `d28d8a6cb2e8`; `npm ci` passed; 142 test files and 1,922 tests passed; `release:clean-check` passed.

The source checkout remains the authoritative copy of the uncommitted work until parity verification succeeds.

## Safety Invariants

1. Freeze the source root. No feature session may write to `/Users/dongpinhu/Desktop/UAIS` during recovery.
2. Never use `git add .`, broad staging, shared stash, `git reset --hard`, or broad `git clean -fd` in the recovery phase.
3. Use explicit path manifests for every transfer and commit.
4. Keep ignored/local-only and secret-like paths outside content/hash and commit manifests. A disposition manifest may record only their relative path and redacted category.
5. Keep one compose worktree only. Do not create one worktree per package during recovery.
6. Do not prune existing worktree metadata until final cleanup approval.
7. Do not update `main` until the compose branch is clean, content-equivalent, and fully verified.
8. Stop if the source inventory changes after the recovery snapshot is created.
9. Stop if any path is unmapped, mapped to multiple final owners, or missing from the compose parity report.
10. Stop if available disk falls below 8 GiB before an install or build step.

## Recovery Architecture

The recovery uses two distinct surfaces:

1. **Frozen source inventory** — the existing dirty root remains untouched and supplies the authoritative current file contents.
2. **Clean compose worktree** — a sibling worktree based on the rescue `HEAD` receives the source inventory in owner packages and becomes the review/integration candidate.

The data flow is:

`frozen source root` -> `source manifest and backup` -> `R0-R5 owner packages` -> `clean compose branch` -> `parity and full gates` -> `owner review` -> `separate main/cleanup approval`

This deliberately differs from the future steady-state workflow. Recovery is sequential because the already-mixed changes have cross-package dependencies. Future feature work can return to parallel worktrees after the root is clean.

## Recovery Evidence

The implementation plan will create or refresh these canonical artifacts:

- `coordination/release-intake/current-recovery-dirty-map.json`
- `coordination/release-intake/current-recovery-source-manifest.json`
- `coordination/release-intake/current-recovery-owner-packages.json`
- `coordination/release-intake/current-recovery-parity-report.json`
- `coordination/reports/2026-07-10-uais-dirty-worktree-recovery-verification.md`

An external, non-Git backup will be created under:

- `/Users/dongpinhu/Desktop/UAIS-dirty-worktree-backups/2026-07-10-recovery-source`

The external backup will contain only recovery evidence needed to restore the 44 tracked modifications and 71 untracked commit-candidate source paths. It must not include ignored/local-only or secret-like content. The backup manifest will store relative paths, status classes, sizes, and SHA-256 hashes for commit candidates, but no secret values. The local-generated quarantine path is recorded only by relative path and redacted category.

## Owner Mapping Completion

Before transferring source files, the 19 currently unmapped paths must be assigned as follows:

| Paths | Final owner | Package |
| --- | --- | --- |
| `tsconfig.json` | S10/S22 | R1 |
| `.github/workflows/critical-flow.yml` | S10/S11/S22 | R1 |
| `CONTRIBUTING.md`, `SCOPE.md` | S10 | R5 |
| `migrations/0001_core_poc.sql`, `scripts/apply-core-migrations.mjs` | S12 with S10 script coordination | R2 |
| `src/lib/db/` | S12 | R2 |
| `src/app/healthz/route.ts` | S22 | R1 |
| `src/instrumentation.ts`, `src/instrumentation-client.ts`, `src/sentry.*.config.ts`, `src/lib/observability/` | S22 | R1 |
| `src/lib/release/deployment-lanes.ts` | S22 | R1 |
| `src/lib/release/env-surface.ts` | S19/S22 | R1 |
| `src/lib/adaptive-learning/recommendations.ts` | S15 | R4 |
| `src/lib/teaching/course-readback.ts` | S05/S12 | R2 |
| `docs/technical-advisory/.Rhistory` | local-archive-only | Q0 — exclude from Git and content backup |

The disposition map must finish with 116 classified paths: 115 mapped to exactly one R1-R5 commit package and one mapped to Q0. Shared reviewers may be recorded, but every commit candidate must have one final commit package. Q0 must never be staged.

## Recovery Packages

### R0 — Recovery control and governance

Purpose: establish the immutable source snapshot and package boundaries.

Contents:

- Fresh dirty map and source manifest.
- Updated owner pathspec coverage.
- Owner package manifest.
- Source status fingerprint.
- External backup manifest reference.

Checks:

- All 116 source status paths appear exactly once in the disposition inventory.
- The inventory resolves to 115 commit candidates plus one Q0 local-generated path.
- 44 tracked and 72 untracked counts match the frozen source status.
- No staged, ignored, local-only, or secret-like path appears in a commit package or content/hash backup manifest.
- Recovery scripts and JSON parse successfully.

### R1 — Platform, release, configuration, and observability

Owners: S10, S19, S22, with S11 review for CI.

Contents:

- `package.json`, `package-lock.json`, `next.config.ts`, `tsconfig.json`.
- `.env.local.example` names only; no real values.
- Critical-flow GitHub workflow.
- `/healthz`, instrumentation, Sentry configuration, observability helpers.
- Deployment-lane and environment-surface contracts.
- Focused tests whose sole purpose is to verify this package's contracts.

Checks:

- `npm ci --no-audit --no-fund` after package files are transferred.
- `npm run lint`.
- Targeted health, environment-surface, deployment-lane, and observability tests.
- `npm run build` if the package changes the build/type boundary.

### R2 — Authentication, backend APIs, managed data, and course readback

Owners: S12, with S05/S19/S22 review where relevant.

Contents:

- Modified API routes and proxy/auth/session contracts.
- Server repositories and access checks.
- Core database schema and migration manifest.
- Postgres teaching-course repository and migration runner.
- Course readback contract.
- Focused auth, database, backend-flow, and course-management tests.

Checks:

- App-session and proxy-auth tests.
- Core database/schema tests.
- Teaching-course management, Postgres policy, and readback tests.
- Critical backend flow tests.
- `npm run lint`.

### R3 — Product routes, shells, pages, and design surface

Owners: S01-S06.

Contents:

- Learning, chatroom, teaching, and legal route changes.
- Layout/header and page shells.
- Course, learning, login, student-dashboard, and teaching components.
- Global CSS change.
- Focused route, page, accessibility, and privacy tests owned by this package.

Checks:

- Relevant route/page tests.
- Accessibility and privacy baseline tests where the rendered contract changes.
- `npm run lint`.

### R4 — AI orchestration, adaptive learning, and playback helpers

Owners: S07 and S15.

Contents:

- LangGraph runtime and orchestration changes.
- App-auth and learning playback helpers owned by the AI/learning boundary.
- Adaptive recommendation implementation.
- Learner-profile and related learning helper additions.
- Focused AI, LangGraph, adaptive-learning, learner-profile, and HITL tests.

Checks:

- AI orchestration and LangGraph tests.
- Adaptive recommendation and learner-profile tests.
- Learning AI guide/HITL scope tests.
- `npm run lint`.

### R5 — Regression coverage, documentation, and handoff evidence

Owners: S10 and S11, with contributing session logs retained as evidence.

Contents:

- Remaining cross-package and release-regression tests not committed with R1-R4.
- README, CONTRIBUTING, SCOPE, API/architecture/runbook documents.
- Technical-advisory documents already present in the source inventory.
- Current coordination reports and session logs.

Checks:

- Documentation link/path checks.
- `git diff --check`.
- Full `npm run lint`.
- Full `npm run test`.
- Full `npm run build`.

## Transfer Method

The implementation plan must use an explicit transfer manifest rather than stash or broad directory copying.

- For each tracked modification, copy the current source file content to the same relative path in the compose worktree. Preserve a binary-capable diff in the external backup.
- For each untracked source file, copy only the manifest-listed file to the same relative path.
- If a future refresh discovers a tracked deletion, represent it explicitly as a deletion in its owner package.
- After transfer, compute the compose hash for every source path and compare it with the frozen source manifest before committing.
- Stage only the package's manifest paths.
- Record the exact staged file list before each commit.

No package may silently include a file from a later package.

## Commit Strategy

The expected commit sequence is:

1. `docs: define UAIS dirty-worktree recovery design`
2. `chore: establish UAIS recovery inventory and owner packages`
3. `chore: recover UAIS platform and release foundation`
4. `feat: recover UAIS backend and managed data slice`
5. `feat: recover UAIS product route and page slice`
6. `feat: recover UAIS AI and adaptive learning slice`
7. `test: recover UAIS regression and documentation slice`
8. `docs: verify UAIS dirty-worktree recovery composition`

The exact messages may be refined in the implementation plan, but the package boundaries must not be collapsed into a single WIP commit.

## Failure Handling

### Source inventory changes during recovery

Stop immediately. Do not merge new source changes into an in-progress package. Refresh the source fingerprint and ask whether the new changes belong to this recovery or a later worktree.

### Owner coverage is incomplete or overlapping

Stop before transfer. Resolve the owner map first; never guess during staging.

### A package fails targeted checks

Keep the failure inside the compose worktree. Determine whether the package is missing an earlier dependency or contains a real source defect. Do not widen the package silently. Record the dependency or blocker and adjust the package order through an explicit plan update.

### Source-to-compose parity fails

Do not clean the source root and do not update `main`. Re-copy only the mismatched manifest paths, recompute hashes, and repeat parity verification.

### Disk pressure

Keep one compose worktree. Do not copy `node_modules`, `.next`, `.tmp`, ignored outputs, or local archives from the source root. Stop before install/build if available space falls below 8 GiB.

### Secret-like path appears

Exclude it from Git operations, do not inspect its value, and record only a redacted category. Stop if a required source path cannot be safely classified.

## Compose Completion Gates

The compose branch is ready for owner review only when all of the following are true:

- The frozen source fingerprint is unchanged.
- All 116 source status paths have exactly one disposition: 115 in R1-R5 and one in Q0.
- Source-to-compose SHA-256 parity passes for all 115 commit candidates.
- The Q0 path remains absent from the compose worktree and unchanged in the frozen source root.
- Additional recovery artifacts are intentional and separately listed.
- Every R0-R5 commit uses explicit pathspecs.
- No ignored/local-only or secret-like path is tracked.
- `git diff --check` passes.
- `npm run lint` passes.
- `npm run test` passes with no failed test files.
- `npm run build` passes.
- `npm run release:clean-check` passes after all commits.
- `git status --short --untracked-files=all` is empty.
- A recovery verification report identifies the compose commit, source fingerprint, checks, risks, and deferred approvals.

## Deferred Main Integration and Root Cleanup

This section describes the later decision but does not authorize it.

After the compose completion gates pass, S25 will present the compose commit and verification evidence to the owner. With separate approval:

1. Update local `main` by fast-forward only; do not force-move it.
2. Verify the updated `main` in a clean checkout with lint, test, build, and release-clean gates.
3. Reconfirm the source backup, 115-path compose parity evidence, and one-path Q0 disposition.
4. Restore the 44 tracked source paths to their committed state using their explicit manifest.
5. Remove only the 71 manifest-listed untracked commit-candidate source paths.
6. Apply the separately approved Q0 disposition to the local-generated path; do not delete or retain it by assumption.
7. Confirm all other ignored/local-only paths remain untouched.
8. Remove the temporary compose worktree after integration.
9. Prune only the two already-missing stale worktree records.
10. Return the root checkout to a clean `main` integration surface.

No broad reset or clean command is permitted without an additional, command-specific owner approval.

## Future Steady-State Worktree Workflow

After recovery:

- Keep the root checkout on clean `main` or a designated clean integration branch.
- Start every feature session in a sibling worktree under `/Users/dongpinhu/Desktop/UAIS-worktrees/`.
- Use branches such as `codex/S12-auth-provider` or `codex/S05-teaching-readback`.
- Never check out the same branch in two worktrees.
- Avoid stash; each worktree keeps its own uncommitted state.
- Require `release:clean-check` before a root/integration session starts.
- Require targeted checks before a package is offered for composition.
- Require full lint/test/build gates in the compose or PR candidate.
- Remove merged worktrees promptly.
- Add a Git remote and PR workflow only in the separately approved Phase B.

## Success Criteria

Recovery is complete only when:

1. No source work is lost.
2. All 115 commit-candidate paths are preserved in reviewable owner-scoped commits, and the one Q0 path has an explicit non-Git disposition.
3. The compose branch is clean and passes parity, lint, test, and build gates.
4. The owner has reviewed the compose verification evidence.
5. A separately approved `main` fast-forward succeeds.
6. A separately approved source-root cleanup leaves the root clean without touching ignored/local-only paths.
7. Stale worktree metadata is removed and the future worktree protocol is documented.

Until items 5-7 receive separate approval and pass verification, the overall dirty-worktree recovery goal remains incomplete.
