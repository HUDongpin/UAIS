# S25 UAIS local branch/worktree consolidation receipt

- Execution date: 2026-08-31 (Asia/Hong_Kong)
- Session: `S25`
- Owner authorization: approved the complete "UAIS 本地分支与 Worktree 单一化计划" and requested implementation.
- Result: `LOCAL_TOPOLOGY_PASS`.
- Boundary: local refs, registered worktrees, external archive custody, and recoverable same-volume Trash only. No remote ref mutation, push, deployment, provider call, database operation, production mutation, or Trash emptying.

## Starting state

The fresh execution intake found:

- 10 local branches under `refs/heads/*`;
- 8 registered worktrees, including the primary root;
- primary root on `codex/root-intake-hold-20260828@0eb5f1dc44ccfb8d77c94cb1b6919f4236302c92`;
- canonical `main@fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541`, equal to live `origin/main`;
- 38,652 non-ignored untracked root paths, including two paths that conflicted with tracked paths in `main`;
- `codex/uais-automation-graph-v1` with 34 tracked modifications and 343 untracked files;
- 4 local annotated archive tags, 2 `refs/preserve/*` refs, and 32 Codex transient tree refs;
- 5 live remote heads;
- no Git lock, locked worktree, or prunable worktree registration.

## Stable Git-history preservation

Fresh archive package:

`/Volumes/Starship/UAIS-archives/2026-08-31/UAIS-S25-local-topology-precleanup-20260831-014804-HKT`

Bundle:

`UAIS-S25-local-topology-precleanup-20260831-014804-HKT.bundle`

- SHA-256: `a17a006c437545b61a141ea40313b722d5577e1eb812daa36ac09503ee76caad`
- Size: 26,457,727 bytes
- Stable refs: 16 = 10 heads + 4 annotated tags + 2 preserve refs
- Codex transient refs included: 0
- Remote-tracking refs included: 0
- `git bundle verify`: PASS; complete history; SHA-1 object format
- Independent ref-by-ref restoration: 16/16 exact objects
- Independent verifier `git fsck --full`: PASS with zero output

The 32 running-session `refs/codex/turn-diffs/*` tree refs were intentionally left untouched. They are not part of the one-branch contract and no `gc` or `prune` operation was performed.

## Dirty working-copy custody

### Root switch collisions

The two divergent untracked S10 log versions were moved exactly to:

`.../dirty-custody/root-collision/working/`

The corresponding `main` versions were separately exported to:

`.../dirty-custody/root-collision/main/`

Working-version hashes:

- `2026-08-22-S10.md`: `9b7e62f9bb712777b64f51c8341844170cf95de0bf642c463eec5ce17c2d74a2`
- `2026-08-23-S10.md`: `dcd5392470d048fb332b014a1811a339e1f160dcbd08024c5865d8e2209175d1`

High-confidence and broad credential-shape scans returned zero candidate files. No content values were emitted. After custody, the complete non-ignored and ignored root-vs-main collision count was zero.

### Automation overlay

The 34 tracked + 343 untracked automation overlay was preserved under:

`.../dirty-custody/automation/`

Key evidence:

- tracked path-set SHA-256: `04e3ea7b1bdfd28bcc6f6395bbc2fa6acfce2feb0a3ef14fa00a024ddbec26a0`
- untracked path-set SHA-256: `fca8af7785ea9cde04a4dea538a37dbf9f29af1d17d5b40f261e11e926dab048`
- binary patch SHA-256: `03ff813fdd24595b1019627e82aca6cf2ca2a34ad0795571987279cda61ab182`
- untracked archive: `untracked-working-copy.tar`
- source/reconstructed manifest: 377/377 hash, size, path, and final mode matches
- independent reconstructed state: 34 tracked + 343 untracked at exact base `0eb5f1dc44ccfb8d77c94cb1b6919f4236302c92`
- reconstructed `git diff --check`: PASS
- reconstructed `git fsck --full`: PASS

The redacted scan recorded one non-empty high-confidence candidate path, structurally confined to a test fixture using `example.invalid` and deterministic placeholder digests; the number of individual pattern occurrences was not independently established. The raw NUL-delimited path lists retain leading empty records, and the corrected summary counts only non-empty records. Candidate values were not reproduced in this receipt.

Restoring the tracked `.gitignore` exposed a second layer of 23,774 `.scratch` paths. The entire 195 MiB scratch tree, including 266 nested test repositories and one symlink to the surviving root, was moved by exact same-volume rename to recoverable Trash. The symlink was not followed and the surviving root inode remained unchanged.

## Recoverable local-output custody

Ignored evidence/runtime directories that would otherwise have been removed with their worktrees were moved by exact same-volume rename under:

`/Volumes/Starship/.Trashes/501/UAIS-S25-local-topology-20260831`

This includes bounded `.tmp`, `output`, `.vercel`, automation `.scratch`, and automation untracked payload trees for the retired worktrees. Source and destination inode checks passed. Trash was not emptied.

Generated `.next`, `node_modules`, `next-env.d.ts`, and TypeScript build cache paths were removed only as part of ordinary non-force `git worktree remove`. Symlink targets in the surviving root were checked by inode before and after automation/P1 removal and were unchanged.

## Branch/worktree retirement

Ordinary non-force worktree removal followed by ordinary branch deletion was completed for:

- `codex/final-source-overlay-integration-376efeda-20260827@540dc39f5b8ed9f5b5f4898296dc58c94f1a3692`
- `codex/p2-membership-id-fix-v1@80a323b430a3c126e4ea60088a3a45c1bba58143`
- `codex/soak-admission-provenance-hardening-540dc39@be0a5eb3e662e2f09530124bea77f77c7654f681`
- `codex/uais-transcript-cas-80a-20260830@fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541`
- `codex/uais-transcript-cas-80a-20260830-integration@fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541` (no worktree)
- `codex/root-intake-hold-20260828@0eb5f1dc44ccfb8d77c94cb1b6919f4236302c92`
- `codex/uais-automation-graph-v1@0eb5f1dc44ccfb8d77c94cb1b6919f4236302c92`

Primary-root transition used the approved detached bridge:

1. root local-only path set before switch: 149,905 paths;
2. normal `git switch --detach fa1fd14...`;
3. tracked tree and full local-only path-set digest verified unchanged;
4. clean linked `main` worktree removed non-force;
5. primary root bound to `main`;
6. old root-hold branch deleted ordinary.

Archive-only exact forced branch retirement was completed only for the two pre-approved non-ancestor refs:

- `codex/p1-learning-closed-loop@03283084426638c4d8d56e7483ce63a42bc30d3b`: `git cherry main` = 6 patch-equivalent, 2 patch-unique; exact annotated tag and bundle/verifier recovery passed before and after deletion.
- `codex/p1-p2-integration-candidate-20260822@7c18bdcd1d81f5cb6b3e1f83695b84edc56bcc2b`: `git cherry main` = 15 patch-equivalent, 0 patch-unique; exact annotated tag and bundle/verifier recovery passed before and after deletion.

No other branch used forced deletion. No worktree used forced removal.

## Final verified topology

- `refs/heads/*`: exactly one ref, `main@fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541`
- registered worktrees: exactly one, `/Volumes/Starship/UAIS` on `refs/heads/main`
- physical children under `.worktrees/`: zero
- detached worktrees: zero
- locked/prunable/stale worktrees: zero
- Git lock files: zero
- staged tracked paths: zero
- unstaged tracked paths: zero
- local `main` equals cached and live `origin/main`

Other retained namespaces:

- annotated tags: 4
- `refs/preserve/*`: 2
- `refs/codex/turn-diffs/*`: 32 at the final pre-receipt audit
- remote-tracking refs: 6
- live remote heads: 5

## Root cleanliness and claim ceiling

Before adding this receipt/session evidence, root retained 38,650 non-ignored untracked paths and 111,252 ignored paths. These are primarily local scratch/evidence and secret-like categories that were outside the destructive cleanup allowlist.

The fresh post-receipt completion audit recorded:

- non-ignored untracked paths: 38,653 (the prior 38,650 plus these three required S25 evidence files);
- ignored paths: 111,252;
- primary-repository `git fsck --full`: exit 0, with only 73 dangling trees, 16 dangling blobs, and 4 dangling commits; zero error/missing/corrupt/fatal/broken findings;
- independent verifier `git fsck --full`: exit 0 with zero output.

Therefore the accurate result is:

```text
TOPOLOGY_PASS=YES
TRACKED_TREE_CLEAN=YES
WORKTREE_CLEAN=NO
REMOTE_MUTATION=NO
DEPLOYMENT_OR_PRODUCTION_MUTATION=NO
```

Product lint, tests, build, browser smoke, provider smoke, and deployment checks were not run because no tracked `main` bytes changed. This cleanup proves local Git topology and preservation only; it is not a release or production-readiness claim.

## Auditability limitation

The current Git topology, archive bytes, Trash custody, and live remote endpoint were independently rechecked. Those static artifacts prove the final state and recoverability, but do not by themselves form a non-repudiable history of every command-line flag or prove that no short-lived external action was later reverted. Exact non-force/force command use is evidenced by the current Codex tool transcript and this execution receipt; no GitHub, Vercel, provider, database, or production audit-log export was requested or created. Accordingly, this receipt claims the verified current state and observed no-external-mutation boundary, not an immutable third-party operations audit.
