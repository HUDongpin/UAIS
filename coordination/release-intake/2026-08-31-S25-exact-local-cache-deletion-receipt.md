# S25 exact local cache deletion receipt

- Date: 2026-08-31 (Asia/Hong_Kong)
- Final status: `PASS`
- Repository: `/Volumes/Starship/UAIS`
- Branch and HEAD: `main@fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541`
- Deletion completed: `2026-08-31T18:43:31.959+08:00`
- Final deletion driver SHA-256: `217600c40cb31b6146c81e2adec4b0c155175a42defe51382c01e8b5d495f24f`

## Owner authorization and exact scope

The owner explicitly authorized permanent deletion only after the last-moment process, open-handle, path-identity, symlink-containment, Git-classification, and manifest-SHA gates passed. The authorized implementation was literal-path, no-follow deletion. The owner explicitly prohibited automatic `npm ci`, `npm run build`, and all previously excluded paths.

Exactly these ten source paths were deleted:

1. `/Volumes/Starship/UAIS/node_modules`
2. `/Volumes/Starship/UAIS/.next`
3. `/Volumes/Starship/UAIS/tsconfig.tsbuildinfo`
4. `/Volumes/Starship/UAIS/next-env.d.ts`
5. `/Volumes/Starship/UAIS/.DS_Store`
6. `/Volumes/Starship/UAIS/.tmp/.DS_Store`
7. `/Volumes/Starship/UAIS/coordination/.DS_Store`
8. `/Volumes/Starship/UAIS/docs/.DS_Store`
9. `/Volumes/Starship/UAIS/public/.DS_Store`
10. `/Volumes/Starship/UAIS/src/.DS_Store`

The authorization did not extend to either parent directory or to any wildcard. No `git clean`, wildcard/glob deletion, `find -delete`, parent-directory deletion, symlink-following deletion, Trash emptying, remote mutation, deployment, provider, database, or production action was used.

## Strict exclusions retained

The following remained outside the deletion set:

- `.playwright-cli`
- `.tmp/` except the exact child `.tmp/.DS_Store`
- `.scratch` and every `.scratch-*` path
- `coordination/` except the exact child `coordination/.DS_Store`
- `.vercel`
- `.claude`
- secret/provider-like categories
- owner/reference/AI asset/QA/export/evidence material
- every other tracked, untracked, or ignored path

The deletion driver's non-candidate metadata fingerprint covered every repository node except `.git` and the ten exact candidates. It was identical before staging, after staging, and after deletion:

```text
nodes  = 115,453
SHA256 = b1a63e6637f836e69b3c59c1e0ffd7cc4c296eecc635ff8a0a3ffb4869040067
```

This fingerprint used path and `lstat` metadata only; it did not read secret-like file contents.

## Last-moment gates

All volatile gates were run twice by the final driver immediately before its first rename. The driver was invoked from `/private/tmp`, outside UAIS.

- Collaboration state: only the root task was active when the final attempt began.
- Codex task inventory: the last successful app inventory showed exactly one active task with cwd `/Volumes/Starship/UAIS`, the current task. Two later refresh calls timed out and returned no contradictory state; the authoritative last-moment filesystem/process gates below were fresh and stable.
- Repository-cwd processes: three processes in both snapshots, PIDs `18319`, `34088`, and `48290`; each was UID `501`, state `S`, exact ChatGPT `node_repl`, parented by the ChatGPT Codex executable, grandparented by the ChatGPT app, and had zero active children.
- UAIS project runtimes: `0` in both snapshots.
- Targeted candidate handles: `0` in both snapshots.
- Whole-visible-file candidate handles: `0` in both snapshots.
- UAIS unlinked-open files: `0` in both snapshots.
- `lsof` diagnostics: clean.
- `.next/lock`: absent.
- Git lock files: `0`.
- Candidate root identity: `.next` and `node_modules` were real directories; the other eight roots were real regular files; no candidate root was a symlink; every candidate realpath equaled its literal source path.
- Candidate path drift: none between the initial and last-moment audits.
- Candidate symlinks: `70` total; `64` in `node_modules` and `6` in `.next`; lexical and canonical targets were confined to their allowed roots; outside-root and dangling counts were both `0`.
- Candidate hardlink duplicate inodes: `0`.
- Tracked candidate records: `0`.
- Repository staged tracked changes: `0`.
- Repository unstaged tracked changes: `0`.
- Candidate classification: all candidate records were ignored/untracked; directory probes used explicit directory intent (`.next/` and `node_modules/`) with `git check-ignore --no-index`.
- Local topology: one branch and one registered worktree, both exact `main@fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541` at `/Volumes/Starship/UAIS`.

Manifest gates were tracked-clean and exact:

```text
package.json      098bac6c70ec48f4e8b32c427e0b0f06d233c2bc31a9ff4d20d036466e7bc5d1
package-lock.json abff0f688ef5f2fd4b8ed982eecdfadfc2740c19e92768fb243d090b6d407b97
```

Two independent read-only reviewers inspected the final deletion driver and returned `GO` before the successful attempt.

## Fail-closed rehearsal and rollback record

Two earlier executions reached same-volume staging but stopped before the first unlink because the post-staging ignore probe did not express the absent `.next` path with directory intent:

- `2026-08-31T18:39:13.822+08:00`: `POST_STAGING_GATE_ABORTED_ROLLED_BACK`
- `2026-08-31T18:41:15.045+08:00`: `POST_STAGING_GATE_ABORTED_ROLLED_BACK`

For both attempts, rollback was complete, every original source path and inode identity was restored, every staging destination was absent afterward, the private staging directory was removed, and no unlink had begun. The final driver retained the gate and corrected its directory probes rather than bypassing the check. Both independent reviewers then returned `GO` again for the final SHA.

## Deletion method and result

The final driver created a private mode-`0700`, same-volume staging directory under `/Volumes/Starship`, renamed only the ten hard-coded literal source paths into hard-coded staging names, verified inode identity after every rename, re-ran the preservation/Git/manifest/lock gates, and then recursively removed staging nodes using only `lstat`, `unlink`, and `rmdir`.

Symlinks were unlinked as links; the walker never descended through them. `.next` was processed before `node_modules` so its six repository-local link targets remained resolvable during the containment audit. The private staging directory was absent after completion.

Deleted inventory, including the ten roots:

```text
entries         = 68,261
regular files   = 62,617
directories     = 5,574
symlinks        = 70
logical bytes   = 1,644,688,371
allocated bytes = 1,818,685,440
allocated GiB   = 1.694
```

Filesystem free-space observation:

```text
before         = 3,103,829,987,328 bytes
after          = 3,105,691,627,520 bytes
observed delta = 1,861,640,192 bytes (about 1.734 GiB)
```

The `st_blocks` inventory and the APFS free-space observation measure different layers, so their difference is not treated as an inconsistency.

Git path counts immediately before the receipt was created:

```text
non-ignored untracked: 38,654 -> 38,654
ignored:              111,252 -> 48,565
ignored delta:                   62,687
```

## Independent postflight

An independent postflight, separate from the deletion driver's own final snapshot, confirmed:

- all ten literal source paths absent under no-follow existence checks;
- no `UAIS-cache-delete-stage.*` directory present under `/Volumes/Starship`;
- no UAIS unlinked-open file;
- `.playwright-cli` retained with `475` nodes (`474` files, `1` directory, `0` symlinks) and `9,187,328` allocated bytes;
- `.tmp` retained with `46,427` file/symlink leaves after deleting only `.tmp/.DS_Store` (`46,375` regular files and `52` symlinks); the tree summary including the `.tmp` root was `65,820` nodes;
- the complete top-level scratch family retained: `.scratch` and `.scratch-p2-final.47XEGi`;
- `coordination`, `.vercel`, and `.claude` retained;
- one local branch: `main@fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541`;
- one registered worktree: `/Volumes/Starship/UAIS`, on that exact branch and SHA;
- staged and unstaged tracked changes: `0`;
- Git locks: `0`;
- `git worktree prune --dry-run --verbose`: empty;
- both manifest SHA-256 values unchanged;
- live `git ls-remote --heads origin`: only `refs/heads/main@fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541`.

The live remote query proves the advertised head set at that point in time. It does not prove deployment, provider, database, webhook, or production state.

## Recovery and checks intentionally not run

This was permanent unlink-based deletion, not a Trash move. The deleted cache/build material is not recoverable from Trash.

Reconstruction, under separate authority, would begin with `npm ci` from the unchanged lockfile and then use a controlled local `npm run build` when build output is needed. `npm run vercel-build` is not an equivalent local reconstruction command because project policy says it can apply live database migrations. Provider-bearing build environments also require the appropriate S19/S22 boundary.

Not run, by explicit owner instruction:

- `npm ci`
- `npm run build`
- `npm run vercel-build`
- lint, unit tests, browser tests, or product smoke tests

Consequently, this receipt proves exact cache deletion, exclusion preservation, Git/topology integrity, and manifest integrity. It does not claim that the dependency-less checkout can currently run, build, or pass product tests.
