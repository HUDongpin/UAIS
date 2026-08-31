# S25 branch/worktree cleanup execution receipt

- Closed-loop review: 2026-08-27 12:15 HKT
- Session: `S25`
- Owner instruction: execute the accepted preserve-first cleanup order.
- Boundary: local Git/archive/cache operations plus read-only GitHub ref
  verification. No push, merge, remote-ref mutation, deployment, environment
  mutation, database mutation, production access, or irreversible deletion.

## Current counts

| Surface | Current count | Verified state |
| --- | ---: | --- |
| Local branches | 5 | All exact tips resolved |
| Registered worktrees, including root | 4 | No stale entry in `git worktree prune --dry-run` |
| Unregistered helper containers under `.worktrees/` | 2 | Two verification containers remain; the two preserved standalone parents were subsequently moved to the authorized Trash batch |
| Local S25 archive tags | 3 | Two committed branch tips plus the standalone exact base |
| Live GitHub branches | 1 | `main@fd09ef322d14316cabaf8cc6d33f23dacc0b61b3` |
| Live GitHub tags | 0 | Fresh `git ls-remote --heads --tags origin` returned only `refs/heads/main` |

Local `main@0eb5f1dc44ccfb8d77c94cb1b6919f4236302c92`
is zero commits behind and one commit ahead of live `origin/main`; it was not
pushed.

## Branch/worktree disposition

| Local branch | Registered worktree | State | Current disposition |
| --- | --- | --- | --- |
| `main` | Root | Tracked tree clean; 15 retained top-level untracked entries, including this evidence package | Keep; one unpushed commit and production push is not authorized |
| `codex/p1-learning-closed-loop` | `.worktrees/p1-learning-closed-loop` | Clean; six commits patch-equivalent to final and two unique | Keep; exact tip tagged/bundled, but unique work is not accepted into a release result |
| `codex/p1-p2-integration-candidate-20260822` | None | 15/15 commits patch-equivalent to final, but not its ancestor | Keep; exact tip tagged/bundled; patch equivalence does not permit non-force branch deletion |
| `codex/p1-p2-integration-candidate-20260822-final` | `.worktrees/p1-p2-integration-candidate-20260822` | 19 modified tracked + 14 untracked paths | Keep; dirty and current S22 receipt is `NO_GO / SOAK_NOT_ADMITTED / PRODUCTION_AUTHORIZATION=NO` |
| `codex/p2-quality-ux-a11y-ops` | `.worktrees/p2-quality-ux-a11y-ops` | Clean; ancestor of final | Keep until the descendant candidate is accepted; ancestry into a rejected candidate is not release disposition |

No branch or registered worktree was removed. Every currently conceivable
removal is either release-gated, would require force, or would discard an
unaccepted/dirty surface. `git worktree remove --force`, `git branch -D`,
`git clean`, wildcard deletion, and recursive raw removal were not used.

## Preservation completed

- Added three local annotated tags; none was pushed.
- Created and verified the complete-history two-tip bundle:
  `/Volumes/Starship/UAIS-archives/2026-08-27/UAIS-S25-exact-branch-tips-20260827.bundle`
  (25,665,679 bytes; SHA-256
  `34b3d0edeacd29593ab25fe632f5499c7e07aeb891c82908bc7e0a052995b820`).
- Dependency standalone: exact-base reconstruction PASS for 141/141 dirty
  paths with byte equality and `git diff --check` PASS.
- Invite standalone: exact-base reconstruction PASS for 251/251 dirty paths
  with byte equality and `git diff --check` PASS.
- Invite structural safety review: 12/12 remaining base/working-copy
  URL-shaped test occurrences classified synthetic; zero review-required;
  zero complete or parseable private keys in the 251 dirty files.

After exact owner authorization, both source-derived packages were copied to
their named external second locations and reconstructed only from those
external inputs:

- Dependency package: final manifest 20/20 payload hashes, external
  reconstruction 141/141 paths and bytes, zero mismatches.
- Invite package: final manifest 12/12 payload hashes, external reconstruction
  251/251 paths and bytes, zero mismatches.
- Both external reconstructions passed `git diff --check` and
  `git fsck --full`.

The exact hashes and package boundaries are recorded in
`2026-08-27-S25-external-preservation-reconstruction-receipt.md`. At that
checkpoint both originals remained `DO_NOT_DELETE`. The owner subsequently
provided the separately reserved exact-path Trash authorization; both parents
were then moved recoverably and verified as recorded in
`2026-08-27-S25-standalone-trash-move-receipt.md`.

## Recoverable generated-cache cleanup completed

Twelve exact dependency/cache paths were moved, without wildcards, to:

`/Volumes/Starship/.Trashes/501/UAIS-S25-generated-dependencies-20260827-115601`

- All 12 original paths are absent.
- All 12 recovery paths are present.
- Aggregate logical size: 8,939,468 KiB (about 8.52 GiB).
- Trash was not emptied. The data remains recoverable, and physical-space
  reclamation is not claimed.
- Unique operational evidence, database-dump artifacts, provider-shaped
  fixtures, `.vercel` directories, standalone repositories, registered
  worktrees, and ambiguous scratch content were retained.

## Open gates

1. A clean final candidate and an S22 release decision replacing the current
   `NO_GO`.
2. Exact-SHA checks, explicit production authorization, post-merge/main CI,
   deployment evidence, and live-browser evidence before any production or
   post-release branch/worktree cleanup claim.

The root `npm run release:clean-check` still fails with `spawnSync git ENOBUFS`
while buffering retained untracked verification fixtures. This is a tooling
and dirty-root failure, not a clean or release-ready result.

## Standalone recoverable Trash move — 13:05 HKT

- After separate exact owner authorization, both preserved standalone parent
  directories were moved by same-volume rename to
  `/Volumes/Starship/.Trashes/501/UAIS-S25-standalone-repositories-20260827`.
- Dependency parent inode remained `31411717`; invite parent inode remained
  `31847077`. Both original paths are absent and both exact Trash destinations
  are present.
- Post-move Trash verification: dependency source 141/141 OK, dependency
  evidence 182/182 OK, invite source 251/251 OK; both HEADs remain
  `d830c28ee21afedb95710451d843899bf4ee91db`.
- External preservation packages were not moved or changed; their fresh
  post-move checks remain 20/20 and 12/12 OK.
- Branch count remains five and registered-worktree count remains four; the
  exact branch and worktree snapshot hashes are unchanged. The unregistered
  helper-container count is now two.
- Live remote refs remain one branch
  (`main@fd09ef322d14316cabaf8cc6d33f23dacc0b61b3`) and zero tags.
- Trash was not emptied. No merge, push, deployment, database operation,
  production mutation, branch deletion, or registered-worktree removal was
  performed.
- Dedicated receipt:
  `coordination/release-intake/2026-08-27-S25-standalone-trash-move-receipt.md`.

## Verification-temp helper cleanup — 13:16 HKT

- Re-audited the two remaining unregistered `.worktrees` helper containers.
  Neither was a registered worktree or nested Git repository, and both had
  zero recursive open processes.
- Moved one 48,804 KiB pure test-temp parent and four exact generated build/tmp
  directories totaling 1,498,520 KiB to
  `/Volumes/Starship/.Trashes/501/UAIS-S25-verification-temp-helpers-20260827-1316`.
- Moved the empty `.scratch/test-tmp` directory to the same recovery batch.
  The batch totals 1,547,324 KiB; every moved directory retained its inode.
- Retained the mixed helper parent's eight-file, 88 KiB evidence directory.
  It has aggregate SHA-256 `741123fb...`, and no same-named canonical copy was
  found across the bounded current coordination/archive search roots.
- Retained the reflow `node_modules` symlink after proving it points to the
  existing final registered worktree rather than being dangling.
- Physical first-level `.worktrees` directories are now four: three
  registered non-root worktrees and the one evidence-retention helper. Git
  counts remain five local branches and four registered worktrees.
- Trash was not emptied. No Git ref, branch, registered worktree, remote,
  deployment, database, provider, or production state was changed.
- Dedicated receipt:
  `coordination/release-intake/2026-08-27-S25-verification-temp-helper-cleanup-receipt.md`.

## All-local-refs bundle refresh — 15:35 HKT

- Fresh topology remained five local branches and four registered worktrees;
  only `main` is merged into `main`. Live remote remained one
  `main@fd09ef3...` branch and zero tags; GitHub open PR count was zero.
- Created
  `/Volumes/Starship/UAIS-archives/2026-08-27/UAIS-S25-all-local-refs-20260827.bundle`
  without creating or changing any ref.
- The 26,307,308-byte bundle exports all five local branch tips and all three
  current archive tag objects. `git bundle verify` reports eight refs and
  complete history; SHA-256 is
  `f775b56c133f6c4b12ff10ceecaf463179b9a53cff9d2c8c25e77c3d726a97f1`.
- Branch, tag, and registered-worktree snapshot hashes were identical before
  and after bundle creation. A sidecar checksum was written beside the bundle.
- The bundle does not include final's 19 modified and 14 untracked paths.
  Final remains `NO_GO / SOAK_NOT_ADMITTED /
  PRODUCTION_AUTHORIZATION=NO` and is additionally held by three orphaned
  Playwright/WebKit process current directories. No process was terminated.
- Dedicated receipt:
  `coordination/release-intake/2026-08-27-S25-all-local-refs-bundle-receipt.md`.

## Dirty-final redacted intake — 15:43 HKT

- Re-froze final at `376efeda...`, 19 modified tracked plus 14 untracked;
  release and process gates were unchanged.
- Partitioned the exact dirty set into 9 source/test paths (298,017 bytes) and
  24 evidence/session-log paths (329,285 bytes). Path-list SHA-256 values and
  the exact union were verified.
- Wrote a nine-path source manifest and a 9/9 source-file SHA-256 manifest.
  Tracked/untracked source diff checks passed.
- Counts-only high-confidence secret scan found zero private-key, AWS key,
  GitHub token, Bearer literal, credentialed URL, or non-example env-path
  shapes. Three broad assignment candidates are confined to one test file; a
  value-redacted structural review classified all three as synthetic test
  fixtures, with zero unresolved candidates and no literal emitted.
- Quarantined all 24 coordination artifacts in place because they may carry
  staging/database/provider/runtime evidence. No evidence content was copied;
  only one opaque aggregate binding was recorded.
- No patch or tar was generated. Exact future source-only package and
  reconstruction boundaries are in
  `coordination/release-intake/2026-08-27-S25-final-dirty-intake-receipt.md`.

## Third resumed audit — blocked closure at 15:51 HKT

- Reverified final at `376efeda...`: 19 modified tracked plus 14 untracked,
  exact 33-path union unchanged, 9/9 source hashes unchanged, and no bound
  path newer than the preceding intake.
- Reconfirmed `NO_GO / SOAK_NOT_ADMITTED /
  PRODUCTION_AUTHORIZATION=NO` and the same three live process cwd holders.
- Reconfirmed five local branches, four registered worktrees, no stale
  entry, one remote branch, zero remote tags, zero open PRs, and no new
  ordinary non-force cleanup candidate.
- Reverified external package manifests 20/20 and 12/12, all-local-refs bundle
  checksum/complete history/eight refs, original standalone Trash targets and
  inodes, and the two generated/helper Trash batches.
- No final source package was created because its exact source-only authority
  has not been granted; the 24 evidence/log paths remain separately
  quarantined and unapproved for copy or removal.
- This is the third consecutive resumed audit with the same external gates.
  The goal is returned to `blocked` rather than polling indefinitely or
  crossing content-custody, process, Git, release, or production boundaries.
- Dedicated receipt:
  `coordination/release-intake/2026-08-27-S25-cleanup-resumed-blocked-audit.md`.

## Source-overlay staging and PID termination — 16:53 HKT

- Owner authorization resumed the goal for two bounded actions: final's
  nine-path source-only preservation flow and termination of exact PIDs
  60841/60842/60848. Evidence custody remains in-place; no release or Git
  mutation authority was inferred.
- Built a mode-0700 task-scoped package with a seven-path binary patch and
  strict two-path tar. Eleven manifest-bound payloads pass; path-set deltas
  are zero. Local exact-base reconstruction passes 9/9 hashes, 9/9 byte
  equality, `git diff --check`, and `git fsck --full`.
- The external target and incoming path remain absent. External copy was
  denied before execution pending an explicit exact-path acknowledgement of
  internal-source egress; no workaround was attempted.
- Immediate identity checks matched all three PID/UID/start/basename/parent/
  cwd records. One `TERM` sequence was sent child-to-parent; all three PIDs
  exited and no recursive cwd holder remains. No process group or `SIGKILL`
  was used.
- Final remains 19+14 dirty and `NO_GO / SOAK_NOT_ADMITTED /
  PRODUCTION_AUTHORIZATION=NO`. Five local branches, four worktrees, and zero
  stale entries remain; no ordinary non-force cleanup target is eligible.
- Dedicated receipt:
  `coordination/release-intake/2026-08-27-S25-final-source-overlay-staging-and-pid-receipt.md`.
