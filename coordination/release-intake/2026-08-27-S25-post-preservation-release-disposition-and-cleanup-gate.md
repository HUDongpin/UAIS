# S25 post-preservation release disposition and cleanup gate

Date: 2026-08-27 (Asia/Hong_Kong)

## Current decisions

| Decision class | Fresh result |
| --- | --- |
| Source-only preservation | `ACCEPTED_AS_SOURCE_CUSTODY` |
| Candidate SHA | `376efedae4a7ba4d86fb9a0ec2087a654b71170c` |
| Clean candidate representing current overlay | `NO` |
| S22 release disposition | `NO_GO` |
| Soak admission | `SOAK_NOT_ADMITTED` |
| Integration result | `NOT_ACCEPTED_FOR_RELEASE` |
| Production authorization | `NO` |
| Ordinary branch/worktree cleanup | `NOT_AUTHORIZED` |

This is a fresh read-only S22 disposition after completion of the external
source-only preservation. It is not a mechanical restatement of an older
decision.

## Preservation is complete but does not integrate the overlay

The final source-only package is complete at:

`/Volumes/Starship/UAIS-archives/2026-08-27/final-source-overlay-376efeda`

- final package manifest SHA-256:
  `110845f7ff15cdb3eb2c2f21aa1362154cd40732f59451c3b742baf8a7a20c8f`;
- 13 top-level regular files, 12/12 manifest-covered non-self members;
- external reconstruction receipt SHA-256:
  `45ea8d31530142006bca783aa01d54b35be001a4ec18b45def06b7599ee57185`;
- primary and independent reconstruction both passed 7+2=9 path equality,
  9/9 hashes, 9/9 bytes, patch equality, diff-check, fsck, and metadata gates.

This proves custody and reconstructability only. It does not place the nine
source/test paths into a Git commit, make final clean, change release status,
or accept the integration result.

Final remains:

- branch `codex/p1-p2-integration-candidate-20260822-final`;
- HEAD `376efedae4a7ba4d86fb9a0ec2087a654b71170c`;
- 19 modified tracked paths;
- 14 untracked paths;
- zero staged paths.

The nine approved source/test paths are included in the 33-path overlay but
not in commit `376efeda...`. The other 24 evidence/session-log paths remain
24/24 in place under `RETAIN_IN_PLACE` custody and are not covered by the
source-only package. Therefore a clean checkout of `376efeda...` would omit
the current source overlay, while the current final worktree remains dirty.

## Fresh S22 gate result

The S22 reviewer reran the local soak admission gate against the current
manifest. It matched HEAD and returned the expected exit `2` with
`SOAK_NOT_ADMITTED`.

Current failures or missing executions include:

| Gate | Current result | Evidence boundary |
| --- | --- | --- |
| Exact-candidate staging health | `FAIL` | 4/4 degraded; app `ok`, database `unreachable`, migrations `unknown` |
| P1 regional performance | `FAIL` | operation p95 4,663–10,899 ms versus 1,500 ms; submit window 31,133 ms versus 30,000 ms |
| P2 active-user ramp | `FAIL` | aggregate p95 3,146 ms versus 2,000 ms |
| P2 sustained 200 users × 10 rounds | `NOT_RUN` | stopped after ramp failure |
| Requirement 3 current tagged restore | `NOT_RUN` | only historical d23 evidence exists |
| Field INP p75 | `NOT_RUN` | RUM disabled; 0/12 groups |
| Seven complete human accessibility gates | `NOT_RUN` | no complete 376-bound human records |
| Real-provider/PITR/OSS recovery gates | `BLOCKED_ENV` / `NOT_RUN` | owner-approved provider sources and executions absent |
| Eleven teacher workspaces | `0/11 real-complete` | all remain implemented-unverified |
| Production journey/same-SHA readback | `NOT_RUN` | production authorization remains `NO` |

Current positive evidence is limited to P1 conservation/cleanup, P2 invite
ramp, the production-only dependency audit, and reviewed full-tree mitigation.
The full tree still records 9 moderate and 1 high Vercel build/CLI tooling
findings as `MITIGATED_OPEN`; it is not a clean full-tree dependency result.

## Canonical evidence conflict

`coordination/reports/p2/current-release-gate.md` is internally
contradictory:

- its correction at the top says only requirements 1 and 2 retain current
  PASS evidence and requirement 6 is `FAIL`;
- later lines still claim requirements 1, 2, 3, and 6 are current-candidate
  `PASS`.

The fresh disposition therefore treats these as authoritative fail-closed
current evidence:

- `coordination/reports/p2/current-candidate-closure.json`
  (SHA-256 `a00cb28aa2dddca325d455b5fdc683c7c439853115c020af582f3f6996b330fe`);
- `coordination/reports/2026-08-27-376-soak-admission.json`
  (SHA-256 `76a6292dc3ec4b8c980bfe4de5295ed6b93bb05ea0c6d47f7d8404414c756eec`);
- `coordination/reports/2026-08-27-376-performance-accessibility-release-no-go.md`
  (SHA-256 `2fc526d2d1fd5ac7cf694ab579933be49811a0a9f01f51d0aa9584d8ca88bb72`).

Canonical/current evidence must be normalized before a later acceptance
review. No historical d23/7305 PASS may be promoted to 376 current evidence.

## Live Git/worktree topology

A concurrent workflow created a new branch/worktree during this audit, so the
current count is six local branches and five registered worktrees, with zero
stale entries. It supersedes the earlier 5/4 snapshot.

| Branch | Worktree/state | Cleanup decision |
| --- | --- | --- |
| `main` at `0eb5f1dc...` | root checkout; large existing ignored/untracked surface | keep |
| `codex/p1-learning-closed-loop` at `032830844...` | clean; six patch-equivalent and two unique commits versus final; not final ancestor | keep |
| `codex/p1-p2-integration-candidate-20260822` at `7c18bdcd...` | no registered worktree; 15/15 patch-equivalent but not final ancestor | keep; patch equivalence is not ordinary-delete ancestry |
| `codex/p1-p2-integration-candidate-20260822-final` at `376efeda...` | registered, 19+14 dirty, release rejected | keep |
| `codex/p2-quality-ux-a11y-ops` at `ebf0efa...` | clean and ancestor of final, but final is not accepted or merged to main | keep |
| `codex/uais-automation-graph-v1` at `0eb5f1dc...` | newly registered and actively changing from 1+1 to at least 6 modified + 1 untracked during audit | keep; concurrent owner/workflow, outside cleanup authorization |

`main` is an ancestor of final; final is not an ancestor of `main`. Only P2 is
an ancestor of final. `git worktree prune --dry-run --verbose` reports no
stale entry. No current branch/worktree is eligible for ordinary non-force
cleanup.

## Required resume order

1. Obtain separate authorization for a Git integration operation that creates
   a clean exact-SHA candidate representing the approved source overlay. The
   current external-egress authorization explicitly excludes commit, merge,
   branch/worktree deletion, and push.
2. Preserve the 24 evidence/log paths in place unless the owner separately
   changes their custody. Do not use their retained worktree dirtiness as a
   reason to reset, clean, or force-remove final.
3. Normalize the contradictory canonical evidence, bound to the new exact
   candidate without promoting historical evidence.
4. Run the required current-SHA health, regional P1/P2, restore, provider,
   RUM, human accessibility, and soak gates in separately authorized valid
   environments.
5. Require fresh `SOAK_ADMITTED`, a completed continuous 24-hour soak, and a
   fresh S22 `GO` before release acceptance.
6. Require an explicit owner decision accepting the exact integration result.
7. Only then inventory exact eligible branches/worktrees and request a final
   ordinary non-force cleanup authorization.

No commit, merge, branch/worktree deletion, push, deployment, provider or
database operation, production access, or Trash emptying was performed in
this disposition audit.
