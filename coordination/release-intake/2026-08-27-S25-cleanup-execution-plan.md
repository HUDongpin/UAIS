# S25 branch and worktree cleanup execution plan

- Date: 2026-08-27 (Asia/Hong_Kong)
- Session: `S25`
- Owner authorization: execute the previously recommended preserve-first
  cleanup order.
- Scope: exact-ref preservation, standalone-repository reconstruction,
  recoverable removal of proven-regenerable scratch data, and only those Git
  cleanup actions whose release and ancestry gates pass.

## Current binding state

- Root: `main@0eb5f1dc44ccfb8d77c94cb1b6919f4236302c92`, one commit ahead of
  live `origin/main@fd09ef322d14316cabaf8cc6d33f23dacc0b61b3`.
- Live GitHub: one branch (`main`), no tags, no pull requests.
- Local: five branches and four registered worktrees; no stale registered
  worktree entry in `git worktree prune --dry-run`.
- Final candidate: dirty and explicitly `NO_GO`, `SOAK_NOT_ADMITTED`, and
  `PRODUCTION_AUTHORIZATION=NO`.
- Existing exact-tip bundle: freshly verified complete, SHA-256
  `34b3d0edeacd29593ab25fe632f5499c7e07aeb891c82908bc7e0a052995b820`.
- Root clean-check: not passed; the current script fails with `ENOBUFS` while
  buffering millions of untracked scratch entries.

## Execution order and gates

1. Copy the dependency-remediation minimal evidence set to the external
   archive, anchor the exact base in a complete bundle, reconstruct in an
   isolated temporary directory, and verify the 141-path manifest and hashes.
2. Build an explicit allowlist for the invite-p95 copy, excluding ignored
   assets, real environment/provider metadata, dependencies, builds, and temp
   output. Create a binary-capable exact-base patch, archive it externally,
   reconstruct it, and verify all 251 approved dirty paths.
3. Recheck writers and unique-evidence boundaries. Move only proven
   regenerable root scratch and pure verification-temp helpers to a dated,
   recoverable Trash location. Never use wildcard deletion, `git clean`, or
   raw recursive removal.
4. Recount root, branches, worktrees, and disk usage. Clean registered
   worktrees only when their trees are clean and their exact tips are both
   preserved and disposition-approved. Use non-force worktree and branch
   removal only.
5. Do not push, open/merge a PR, change production, or remove the dirty final
   candidate while its release receipt remains NO-GO. Resume that phase only
   after a clean candidate, exact-SHA checks, explicit production
   authorization, and deployment/live-browser evidence exist.

## Stop conditions

- Any source/manifest drift after preservation begins.
- Any secret-like or private payload would enter an archive.
- A path cannot be reconstructed byte-for-byte from its exact base.
- An active writer or open handle references a proposed cleanup target.
- A branch is neither an ancestor of the accepted integration result nor
  independently preserved with an approved disposition.
- Any action would push `main`, trigger production migration/deployment, or
  claim live proof without a separate explicit gate.

## Execution status — 2026-08-27 12:15 HKT

- Local exact-base reconstructions passed for both standalone candidates.
- Invite literal-safety review passed with zero unresolved occurrences.
- Twelve exact generated cache/dependency paths were moved to recoverable
  same-volume Trash and verified; Trash remains unemptied.
- External second-location source/patch copies were subsequently explicitly
  authorized, written to both exact destinations, package-manifest verified,
  and reconstructed only from their external inputs. Dependency reproduced
  141/141 paths and invite reproduced 251/251 paths with zero hash or byte
  mismatches; both passed `git diff --check` and `git fsck --full`.
- Branch/worktree recount remains five/four. No non-force deletion currently
  satisfies the release and disposition gates because final is dirty and
  `NO_GO`, the old candidate is not an ancestor, and P1 retains unique work.
- The separately authorized standalone parents were subsequently moved
  recoverably to their exact Starship Trash targets after post-copy review.
- The two remaining unregistered verification helpers were reclassified:
  one pure test-temp parent and four generated build/tmp subdirectories were
  moved recoverably (1,547,324 KiB total), while an eight-file, 88 KiB evidence
  directory with no canonical same-named copies was retained in place. An
  empty root scratch test directory was also moved; a live-target symlink was
  deliberately retained.
- Consolidated evidence and remaining gates are recorded in
  `2026-08-27-S25-cleanup-execution-receipt.md` and
  `2026-08-27-S25-external-preservation-reconstruction-receipt.md`; helper
  classification and moves are recorded in
  `2026-08-27-S25-verification-temp-helper-cleanup-receipt.md`.

## Blocked-goal refresh — 2026-08-27 15:35 HKT

- A fresh audit found no Git/ref or release-evidence change since the prior
  checkpoint: five local branches, four registered worktrees, one live remote
  branch, zero remote tags, and no open GitHub pull request.
- Final remains 19 modified tracked plus 14 untracked paths at
  `376efedae...`; its latest authoritative evidence remains `NO_GO /
  SOAK_NOT_ADMITTED / PRODUCTION_AUTHORIZATION=NO`.
- Three four-day-old Playwright/WebKit processes retain current directories
  beneath final's staging-a11y output. They were not terminated.
- Closed one remaining preservation gap without ref mutation by creating and
  verifying a complete-history bundle exporting all five local branch tips
  and all three current archive tags. The bundle SHA-256 is `f775b56c...`;
  dedicated receipt:
  `2026-08-27-S25-all-local-refs-bundle-receipt.md`.
- This preserves committed history only and does not authorize removal of any
  dirty or release-unaccepted worktree/branch.

## Dirty-final intake continuation — 2026-08-27 15:43 HKT

- Release evidence and topology remained unchanged in the second resumed
  audit: final is still 19 modified plus 14 untracked at `376efeda...`, with
  `NO_GO / SOAK_NOT_ADMITTED / PRODUCTION_AUTHORIZATION=NO`; the same three
  Playwright/WebKit processes remain alive under its output tree.
- Completed a value-redacted 33-path intake rather than copying final content.
  The partition is exactly 9 source/test paths and 24 coordination
  evidence/log paths.
- Source/test paths now have a stable path manifest and 9/9 working-file hash
  manifest. High-confidence secret shapes are zero; three broad candidates
  occur only in one test file and were value-redacted structurally classified
  `STRUCTURALLY_SYNTHETIC_TEST_FIXTURE`, with zero unresolved candidates.
- Evidence/log paths are quarantined in place. Only an opaque aggregate
  content binding was recorded; no evidence value or individual evidence hash
  was emitted.
- Dedicated receipt:
  `2026-08-27-S25-final-dirty-intake-receipt.md`.

## Third resumed audit and blocked closure — 2026-08-27 15:51 HKT

- Final's exact 33-path set and nine source hashes remain unchanged; no
  manifest-bound path or final coordination file is newer than the 15:43
  checkpoint.
- Release state remains `NO_GO / SOAK_NOT_ADMITTED /
  PRODUCTION_AUTHORIZATION=NO`; PIDs 60841, 60842, and 60848 remain alive with
  cwd beneath final's staging-a11y output.
- Git topology remains five local branches, four registered worktrees, no
  stale entries, one live remote branch, zero remote tags, and zero open PRs.
  Only `main` is merged into `main`; no branch/worktree has newly become
  eligible for ordinary non-force removal.
- Both external standalone packages, the eight-ref complete-history bundle,
  and all three recoverable Trash batches reverified intact. The unapproved
  final source-overlay destination remains absent.
- The same cleanup blocker has now survived three consecutive resumed audits.
  Because no further safe action exists without new content-custody, process,
  release, or branch-disposition authority, execution returns to `blocked`.
- Dedicated receipt:
  `2026-08-27-S25-cleanup-resumed-blocked-audit.md`.

## Owner-authorized source-overlay/PID continuation — 2026-08-27 16:53 HKT

- Treated the new owner message as explicit authority to build the existing
  nine-path source-only package and terminate exact PIDs 60841, 60842, and
  60848. The 24 evidence/log paths default to `RETAIN_IN_PLACE`; no clean
  exact SHA, S22 `GO`, or exact branch/worktree deletion target was supplied.
- Independent read-only review reproduced the 9/24 partition, 7/2
  tracked/untracked split, 9/9 hashes, bundle binding, and redacted safety
  result.
- Generated a protected 12-member task-scoped staging package. Patch, tar,
  path union, package manifest, and local exact-base reconstruction pass; the
  reconstruction has zero path, hash, byte, diff-check, or fsck mismatch.
- External archive copy remains blocked because the external-write reviewer
  requires a fresh explicit acknowledgement of exporting internal
  source/tests/patches to the exact
  `final-source-overlay-376efeda` destination. Neither incoming nor target
  directory was created.
- Reverified the three exact process identities immediately before sending
  one child-to-parent `TERM` sequence. All three exited; recursive final cwd
  holder count is now zero. No process group or `SIGKILL` was used.
- Process termination does not change final's 19+14 dirty state or `NO_GO /
  SOAK_NOT_ADMITTED / PRODUCTION_AUTHORIZATION=NO`; no branch/worktree is yet
  ordinary non-force cleanup eligible.
- Dedicated receipt:
  `2026-08-27-S25-final-source-overlay-staging-and-pid-receipt.md`.

## External-egress execution packet — 2026-08-27 17:11 HKT

- No new exact external-copy authorization arrived. External target and
  incoming path remain absent; no retry or workaround was attempted.
- A non-source README probe proved that this macOS/Codex host regenerates
  `com.apple.provenance` even after metadata-disabled copy and successful
  `xattr -d`, and attaches the same attribute to a newly touched empty file.
  Zero-xattr acceptance is therefore unattainable on this host.
- Tightened the package and execution contract: never copy source xattrs;
  allow only host-generated `com.apple.provenance` as a destination xattr
  name; require every other xattr/AppleDouble/resource-fork/quarantine/PAX
  count to be zero; continue binding all payload bytes by manifest.
- Regenerated and verified the pre-copy manifest. Current SHA-256 is
  `6006c6c7df67131eda814c5202384dbe083cb1a4c2bd3be66a99a4758cf2bfd5`,
  with 11/11 payload checks; normalized two-member tar remains
  `db3c4f4a...`.
- Frozen the exact authorization, preflight, metadata-disabled incoming copy,
  atomic rename, external 9/9 reconstruction, final receipt/manifest, and
  fail-closed checks in
  `2026-08-27-S25-final-source-overlay-egress-execution-packet.md`.
