# S25 verification-temp helper cleanup receipt

- Completed: 2026-08-27 13:16 HKT
- Session: `S25`
- Governing authorization: execute the accepted preserve-first cleanup plan,
  including recoverable movement of proven-regenerable scratch and pure
  verification-temp helpers.
- Recovery directory:
  `/Volumes/Starship/.Trashes/501/UAIS-S25-verification-temp-helpers-20260827-1316`
- Boundary: exact same-volume moves only. No wildcard deletion, Trash
  emptying, branch/worktree mutation, merge, push, deployment, database
  mutation, production access, or permanent deletion.

## Classification

Two unregistered first-level `.worktrees` helpers were re-audited.

### Pure test-temp container

`/Volumes/Starship/UAIS/.worktrees/.isolated-uais-verification-tmp-20260824`
contained one `old-inrepo-tmp` tree, no nested `.git`, and was not a registered
Git worktree. It contained 1,480 directories and 5,889 regular files, no
symlinks or other file types, and its latest file modification was
2026-08-24 12:04:56 HKT. Its logical size was 48,804 KiB.

Filename-only category counts found test/runtime-shaped material, including 23
`.vercel` directories, 51 `node_modules` directories, 145 files with an `.env`
extension, four database/dump-shaped filenames, and three
credential-shaped filenames. No value was read or copied into this receipt.
Because the entire tree was a generated test-temp location, it was moved as a
single recoverable unit rather than archived or inspected for values.

### Mixed verification parent

`/Volumes/Starship/UAIS/.worktrees/.uais-verification-tmp-parent-20260824`
was also unregistered and contained no nested `.git`, but it was not a pure
cache. Its `work` directory contained four regenerable build/tmp trees plus a
small evidence directory.

The evidence directory contains eight regular files, totals 88 KiB, and has
aggregate path-bound SHA-256
`741123fb19e48376b2d8a973336cef480ba2ab0af9158fcea69e2e65f5e0049c`.
Filename-only searches across root coordination, all three registered non-root
worktree coordination trees, and the current UAIS archive found no same-named
canonical copy for any of the eight files. It was therefore classified
`UNIQUE_EVIDENCE_RETAIN`, not cleanup-eligible. No evidence value was copied or
summarized.

Both helper parents had zero processes with recursive open handles in a final
`/usr/sbin/lsof +D` check before movement.

## Exact recoverable moves

| Source item | KiB | Inode before/after | Trash disposition |
| --- | ---: | ---: | --- |
| `.worktrees/.isolated-uais-verification-tmp-20260824` | 48,804 | `32105062` | Moved as `isolated-uais-verification-tmp-20260824` |
| `.worktrees/.uais-verification-tmp-parent-20260824/work/pre-clean-build-next` | 775,140 | `31920747` | Moved under `uais-verification-tmp-parent-20260824-generated/` |
| `.worktrees/.uais-verification-tmp-parent-20260824/work/tmp` | 80,064 | `32106732` | Moved under `uais-verification-tmp-parent-20260824-generated/` |
| `.worktrees/.uais-verification-tmp-parent-20260824/work/turbo-hang-next` | 1,116 | `32133606` | Moved under `uais-verification-tmp-parent-20260824-generated/` |
| `.worktrees/.uais-verification-tmp-parent-20260824/work/webpack-success-next` | 642,200 | `32142020` | Moved under `uais-verification-tmp-parent-20260824-generated/` |
| `.scratch/test-tmp` | 0 | `34023852` | Moved under `root-scratch-empty/test-tmp` after proving zero files, zero symlinks, and zero open processes |

All source items and the recovery directory were on filesystem device
`16777249`. Every directory inode was preserved, proving same-volume rename.
All six source paths are absent and all six exact recovery paths are present.
The recovery directory totals 1,547,324 KiB. Trash was not emptied, so no
physical-space reclamation is claimed.

## Explicit retention

- The mixed verification parent remains under `.worktrees` with only its
  eight-file evidence directory. The four generated sibling directories are
  absent, and the evidence aggregate hash remains exact.
- `.scratch/reflow-fix.FwyMB8-node_modules-symlink` was not moved. It is not a
  dangling symlink; it targets the existing final registered worktree's
  `node_modules` and may still be functionally required.
- `.scratch/neon-http.ORPrEA`, `.scratch/reflow-fix.FwyMB8` source/evidence,
  `.scratch-p2-final.47XEGi`, and the other source/evidence/provider-shaped
  scratch projections retain their earlier non-disposable classifications.
- No real environment value, provider credential/metadata value, database
  row/dump content, cookie value, or private payload was read into this
  receipt or copied to a new archive.

## Git and release boundary

- Local branches remained five.
- Registered worktrees including root remained four.
- `git worktree prune --dry-run` remained empty.
- Physical first-level `.worktrees` directories are now four: three
  registered non-root worktrees plus the one evidence-retention helper.
- The branch-ref and registered-worktree snapshot hashes remained
  `f0f7d291eada0e26c5d6eb2344b3db172f3134711f9bfbf2a901dd6dfe6cba2f`
  and
  `22be041ea8ac8436e6ca958fca344843bf66cf5e05e1c70d1be535d28cbee030`.
- Live remote state remained one branch,
  `main@fd09ef322d14316cabaf8cc6d33f23dacc0b61b3`, and zero tags.
- The final worktree remained 19 tracked changes plus 14 untracked paths and
  remained governed by `NO_GO / SOAK_NOT_ADMITTED /
  PRODUCTION_AUTHORIZATION=NO`.

No product test, lint, or build was run because no product source was changed.
The verified boundary is filesystem classification, exact recoverable moves,
evidence retention, and unchanged Git topology; it is not product, CI,
deployment, or live-production proof.
