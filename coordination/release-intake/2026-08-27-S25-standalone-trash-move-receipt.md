# S25 standalone repository recoverable Trash move receipt

- Completed: 2026-08-27 13:05 HKT
- Session: `S25`
- Authorization: move exactly two named standalone repository parent
  directories to the named Starship Trash batch after revalidating the
  external preservation packages and source state.
- Boundary: recoverable same-volume directory moves only. Trash emptying,
  branch/worktree mutation, merge, push, deployment, database migration, and
  production mutation remained prohibited.

## Exact moves

| Source | Trash destination | Directory inode before/after | Result |
| --- | --- | ---: | --- |
| `/Volumes/Starship/UAIS/.worktrees/.isolated-uas-dep-remediation-54.17.3-20260824` | `/Volumes/Starship/.Trashes/501/UAIS-S25-standalone-repositories-20260827/dependency-remediation-54.17.3-20260824` | `31411717` | Source absent; destination present at exact realpath |
| `/Volumes/Starship/UAIS/.worktrees/.isolated-uais-invite-p95-20260824` | `/Volumes/Starship/.Trashes/501/UAIS-S25-standalone-repositories-20260827/invite-p95-20260824` | `31847077` | Source absent; destination present at exact realpath |

Both sources and the destination parent were on filesystem device `16777249`.
The unchanged directory inodes prove that these were same-volume directory
renames, not copy-then-delete operations. The destination batch was newly
created at the exact authorized realpath with mode `0700`, owner UID `501`, and
zero children before the moves.

The destination batch now has exactly the two authorized child directories.
Its logical size at the final check was 5,051,960 KiB. Trash was not emptied,
so no physical-space reclamation is claimed.

## Pre-move preservation gate

| Check | Dependency remediation | Invite p95 |
| --- | --- | --- |
| External package manifest self-hash | `ed150df3dfa3086a4d17977d30c3113f00b16e991251e19381dd2968313fb21b` | `21f780f9f2146fd0a567ef69c330c801c2732d63ba9ea83a3c62c4d6df6ccbed` |
| External payload verification | 20/20 OK | 12/12 OK |
| Source HEAD | `d830c28ee21afedb95710451d843899bf4ee91db` | `d830c28ee21afedb95710451d843899bf4ee91db` |
| Dirty-path shape | 84 tracked + 57 untracked = 141 | 139 tracked + 112 untracked = 251 |
| Approved path-set SHA-256 | `1895a3ca472cab33e850eb1ba141ad4c92a13d69f273499198b9411bff132a2b` | `821dc26c60ed2f23c6a0056966eabf192d1e412ad882589995b68c2f0e25108f` |
| Approved-file manifest SHA-256 | `25fd7d3a53f0c27e1bf5a8bb21b5df3a3386dd5ae500a9143aa16e3ef618324f` | `80b7b50b4e801a84556900dd08c6163c92d2551fc257a08e25b56015a94c3291` |
| Source file verification | 141/141 OK | 251/251 OK |
| Approved files regular/non-symlink | 141/141 | 251/251 |
| `git diff --check` | PASS | PASS |

The tracked, untracked, and combined dirty-path lists each matched the external
package manifests byte-for-byte. A final `/usr/sbin/lsof +D` scan found zero
processes with open handles under either parent directory before the moves.

## Post-move verification from Trash

- Both original source paths are absent.
- Both exact Trash targets are present, non-symlink directories, and resolve to
  the authorized realpaths.
- Both repository HEADs remain the exact base
  `d830c28ee21afedb95710451d843899bf4ee91db`.
- Dependency candidate approved-file verification is 141/141 OK; its sibling
  evidence checksum manifest is 182/182 OK.
- Invite approved-file verification is 251/251 OK.
- Both reconstructed dirty-path sets still match their external tracked,
  untracked, and combined manifests.
- Both moved repositories still pass `git diff --check`.
- The external archives remained at their original paths. A fresh post-move
  verification returned dependency 20/20 OK and invite 12/12 OK with the same
  package-manifest hashes shown above.

## Git and release boundary

The local branch-ref snapshot SHA-256 remained
`f0f7d291eada0e26c5d6eb2344b3db172f3134711f9bfbf2a901dd6dfe6cba2f`
before and after the moves. The registered-worktree snapshot SHA-256 remained
`22be041ea8ac8436e6ca958fca344843bf66cf5e05e1c70d1be535d28cbee030`.

- Local branches: 5, unchanged.
- Registered worktrees including root: 4, unchanged.
- `git worktree prune --dry-run`: no stale entry.
- Root HEAD: `0eb5f1dc44ccfb8d77c94cb1b6919f4236302c92`, unchanged.
- Root index tree: `52bcc6b7e8c1dc3c4a53751952e6c5c738712192`, unchanged.
- Root tracked worktree and index: clean.
- Live remote branches: only
  `main@fd09ef322d14316cabaf8cc6d33f23dacc0b61b3`, matching the pre-move query.
- Live remote tags: zero.

There are now five physical first-level directories under `.worktrees/`: the
three non-root registered worktrees and two pre-existing unregistered
verification containers. The two authorized standalone parents are no longer
under `.worktrees/`. Thus the unregistered helper-container count moved from
four to two, while registered worktree count remained four.

The current local release receipts still classify the final candidate as
`NO_GO / SOAK_NOT_ADMITTED / PRODUCTION_AUTHORIZATION=NO`. No production or
provider query is promoted into a release claim here. No Git ref mutation,
merge, push, deployment, database access/migration, Trash emptying, or
permanent deletion was performed.

## Checks not run

No product test, lint, or build was run. This was a filesystem preservation
operation with no product-code change. The verified boundary is exact
path/hash/byte preservation, external-package integrity, Git topology
stability, and recoverability; it is not product, CI, deployment, or live
production proof.
