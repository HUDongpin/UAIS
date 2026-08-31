# S25 exact remote-head deletion receipt

- Date: 2026-08-31 (Asia/Hong_Kong)
- Repository: `HUDongpin/UAIS`
- Session: `S25`
- Result: `PASS` for the advertised remote-head state observed at postflight
- Mutation completed: `2026-08-31T16:31:51+0800`
- Postflight completed: `2026-08-31T16:32:57+0800`

## Owner authorization and scope

The owner explicitly authorized deletion of only these four exact remote refs while retaining `origin/main`, with fresh live `git ls-remote` checks, exact-SHA drift protection, and a deletion receipt:

| Exact remote ref | Authorized expected SHA |
| --- | --- |
| `refs/heads/codex/final-source-overlay-integration-376efeda-20260827` | `540dc39f5b8ed9f5b5f4898296dc58c94f1a3692` |
| `refs/heads/codex/soak-admission-provenance-hardening-540dc39` | `be0a5eb3e662e2f09530124bea77f77c7654f681` |
| `refs/heads/codex/uais-transcript-cas-80a-20260830` | `fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541` |
| `refs/heads/codex/uais-transcript-cas-80a-20260830-integration` | `fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541` |

No other remote ref was authorized. `refs/heads/main` was excluded from every deletion refspec. No commit, merge, rebase, or local branch/worktree topology mutation occurred in the primary `/Volumes/Starship/UAIS` repository. The only remote writes were the authorized Git-transport ref deletions; GitHub API and Git-transport reads were used for preflight and postflight. No application-provider, AI-provider, deployment-provider, database, or production action was authorized or performed.

## Preservation baseline

All four deleted remote tips remain covered by the pre-cleanup stable-ref bundle:

`/Volumes/Starship/UAIS-archives/2026-08-31/UAIS-S25-local-topology-precleanup-20260831-014804-HKT/UAIS-S25-local-topology-precleanup-20260831-014804-HKT.bundle`

- bundle SHA-256: `a17a006c437545b61a141ea40313b722d5577e1eb812daa36ac09503ee76caad`
- bundle size: `26,457,727` bytes
- bundle coverage: 10 pre-cleanup heads, 4 annotated tags, and 2 preserve refs
- fresh bundle verification before this phase: `PASS`
- independent bundle verifier `git fsck --full`: `PASS`

The separately archived automation patch/tar and root-collision custody also remained present. The previously documented same-volume Trash path was already absent at this phase and was not used as the recovery basis for remote deletion:

`/Volumes/Starship/.Trashes/501/UAIS-S25-local-topology-20260831`

Accordingly, stable Git history and the critical archived dirty overlay remain recoverable from the archive, while earlier Trash-only generated/runtime payload custody remains `WARN_ABSENT`.

## Root intake and test gate

The root checkout remained the single registered worktree on `main@fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541`, with zero staged or unstaged tracked paths.

The required root scripts were attempted with path output suppressed to avoid disclosing secret-like local names:

| Gate | Result | Evidence boundary |
| --- | --- | --- |
| `npm run release:clean-check` | `EXIT 1` | Node child-process `maxBuffer/ENOBUFS` on the very large local overlay; not treated as clean |
| `npm run release:dirty-map -- --reason "S25 exact remote-head deletion receipt"` | `EXIT 1` | Same `maxBuffer/ENOBUFS`; replaced by NUL-safe counts and tracked-diff checks |

The standard root test initially discovered three ignored `.tmp` dummy TypeScript fixtures, and a pollution-excluded retry then exposed an incomplete root `node_modules` installation missing declared `@playwright/test@1.62.1`. Neither local runtime surface was modified or deleted.

The final test gate used an exact `fa1fd14d...` clean source clone on the system volume, with lockfile-installed dependencies held in a separate Starship temporary clone and a symlinked `node_modules`. Secret-bearing project environment variables were not inherited. The targeted filesystem-permission test passed `22/22`, followed by the standard deterministic 5-shard suite:

| Shard | Test files | Tests | Result |
| --- | ---: | ---: | --- |
| 1/5 | 51 | 1,036 | PASS |
| 2/5 | 51 | 722 | PASS |
| 3/5 | 51 | 520 | PASS |
| 4/5 | 51 | 787 | PASS |
| 5/5 | 51 | 639 | PASS |
| **Total** | **255 shard-file executions** | **3,704** | **PASS** |

Both temporary clones were removed after successful verification by exact validated-path cleanup without following symlinks. They were ordinary clones, not registered UAIS worktrees.

## Final preflight

Within the pre-mutation observation window, Git transport and GitHub API results agreed:

- remote `HEAD` symbolic ref: `refs/heads/main`
- GitHub default branch: `main`
- local `HEAD`, local `main`, cached `origin/main`, and live `origin/main`: `fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541`
- live head set: exactly `main` plus the four authorized refs
- repository permission reported by GitHub: `ADMIN`
- repository rulesets: none returned
- four target branches: unprotected
- exact-head pull-request queries across all states: zero associations returned
- commit-to-PR queries: zero associations returned
- tracked non-coordination references to each exact branch name: zero
- tracked GitHub Actions `delete` triggers: zero
- tracked workflows: `critical-flow.yml` (`pull_request` and `push` restricted to `main`) and `promotion-gate.yml` (`workflow_dispatch` and `deployment_status`)
- `vercel.json` branch deployment setting: `{"*":false,"**":false,"main":true}`

Commit redundancy was rechecked in the pre-mutation window:

| Target | Main-only / target-only | `git cherry main <tip>` | Disposition gate |
| --- | ---: | ---: | --- |
| `540dc39f...` | `7 / 0` | `+0 / -0` | ancestor of `main` |
| `be0a5eb3...` | `5 / 0` | `+0 / -0` | ancestor of `main` |
| first `fa1fd14d...` alias | `0 / 0` | `+0 / -0` | exact `main` alias |
| second `fa1fd14d...` alias | `0 / 0` | `+0 / -0` | exact `main` alias |

An independent read-only reviewer returned `GO` at `2026-08-31T16:31:33+0800` with the same four-ref lease matrix and the same default-branch, ancestry, PR, ruleset, protection, and workflow findings.

## Atomic deletion transaction

The deletion ran in one sequential `set -eu` shell chain that ended at `2026-08-31T16:31:51+0800` with exit code `0`. The subcommands were ordered in that chain, but individual subcommand timestamps were not captured. The same push arguments first ran with `--dry-run`, which was a no-update preflight against the remote advertisement visible to that invocation; it did not perform deletion, exercise deletion-triggered receive-side effects, or guarantee acceptance of the later real push. A second live equality check then preceded the real push.

The recorded real invocation was:

```bash
git push --porcelain --atomic \
  --force-with-lease=refs/heads/codex/final-source-overlay-integration-376efeda-20260827:540dc39f5b8ed9f5b5f4898296dc58c94f1a3692 \
  --force-with-lease=refs/heads/codex/soak-admission-provenance-hardening-540dc39:be0a5eb3e662e2f09530124bea77f77c7654f681 \
  --force-with-lease=refs/heads/codex/uais-transcript-cas-80a-20260830:fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541 \
  --force-with-lease=refs/heads/codex/uais-transcript-cas-80a-20260830-integration:fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541 \
  origin \
  :refs/heads/codex/final-source-overlay-integration-376efeda-20260827 \
  :refs/heads/codex/soak-admission-provenance-hardening-540dc39 \
  :refs/heads/codex/uais-transcript-cas-80a-20260830 \
  :refs/heads/codex/uais-transcript-cas-80a-20260830-integration
```

Safety properties:

- `--atomic`: the four requested remote ref updates in this push are applied as one remote-side ref transaction, or none are applied on error; the push fails if the server does not support atomic pushes
- atomicity does not extend to webhook delivery, event feeds, installed apps, provider callbacks, or other external side effects
- four explicit `--force-with-lease=<ref>:<expected-SHA>` constraints; each lease protects only its named target ref and does not lock `main`, unrelated refs, or the repository-wide head set
- four exact deletion refspecs
- no wildcard refspec
- no `main` refspec; `main` preservation was checked separately before and after the push
- no force-push of new history

Execution evidence:

```text
FINAL_LIVE_EQUALITY_BEFORE_DRY_RUN=PASS
DRY_RUN_PREFLIGHT_REPORTED_SUCCESS=PASS
FINAL_LIVE_EQUALITY_BEFORE_WRITE=PASS
REAL_PUSH_PORCELAIN_DELETED_REFS=4
REAL_ATOMIC_PUSH_EXIT=0
SHELL_CHAIN_EXIT=0
SHELL_CHAIN_END_HKT=2026-08-31T16:31:51+0800
```

## Postflight

Two live head queries completed by `2026-08-31T16:32:57+0800` after the push and returned exactly one advertised `refs/heads/*` ref:

```text
fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541  refs/heads/main
```

Additional fresh postflight evidence:

```text
LIVE_REMOTE_HEADS=1
REMOTE_DEFAULT=refs/heads/main
GITHUB_DEFAULT=main
LOCAL_BRANCH=main
LOCAL_HEAD=fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541
LOCAL_HEADS=1
REGISTERED_WORKTREES=1
STAGED_TRACKED=0
UNSTAGED_TRACKED=0
GIT_LOCKS=0
PRUNABLE_WORKTREES=0
CACHED_REMOTE_TRACKING_REFS=2
```

The only cached remote-tracking refs after the push were the following local, push-derived consistency evidence; they are not independent proof of remote state:

```text
refs/remotes/origin/HEAD -> refs/remotes/origin/main
resolved refs/remotes/origin/HEAD = fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541
refs/remotes/origin/main = fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541
```

Before writing this new receipt, the root's pre-existing local-only overlay remained at 38,653 non-ignored untracked paths and 111,252 ignored paths. No broad local cleanup was performed.

GitHub's public repository event feed showed at least one branch `DeleteEvent` associated with the deletion window at `2026-08-31T08:31:53Z`; that feed is not treated as a complete per-ref transaction ledger. The two `git ls-remote --heads origin` results are exhaustive listings only of the advertised `refs/heads/*` visible at those query instants; they do not cover tags, hidden/provider-internal refs, every replica, later ref recreation, event delivery, or external consumers. A time-bounded GitHub Actions query returned no run created after the deletion window.

## Claim ceiling

This receipt records and supports the listed, time-bounded preflight observations, the exact locally recorded push invocation and output summary, and the advertised postflight endpoint state in which the only visible `refs/heads/*` ref was unchanged `main`. The receipt and Codex transcript are not a third-party immutable command log.

GitHub's public feed showed at least one `DeleteEvent` associated with the deletion window. Event creation, delivery, completeness, ordering, and installed-app or webhook consumption were not audited. Repository workflows contain no matching `delete` trigger, but this work did not prove the absence of organization-level webhooks, installed-app callbacks, or other external automation. No Vercel-provider audit, deployment audit, production-browser check, or third-party immutable command log was performed. Therefore this receipt does not claim that no external system observed the deletion or that no provider-side event occurred.

## Final decision

```text
AUTHORIZED_REF_SCOPE_RECORDED=PASS
EXACT_SHA_LEASE_COMMAND_RECORDED=PASS
ATOMIC_REF_PUSH_REPORTED_SUCCESS=PASS
LIVE_REMOTE_MAIN_ONLY_AT_POSTFLIGHT=PASS
MAIN_SHA_PRESERVED_AT_POSTFLIGHT=PASS
LOCAL_SINGLE_BRANCH_WORKTREE=PASS
STABLE_HISTORY_BUNDLE=PASS
TRACKED_TREE_CLEAN=PASS
TRASH_ONLY_CUSTODY=WARN_ABSENT
REMOTE_HEAD_CLEANUP_COMPLETE_AT_POSTFLIGHT=PASS
EXTERNAL_PROVIDER_EFFECTS=UNVERIFIED
THIRD_PARTY_IMMUTABLE_COMMAND_AUDIT=NOT_PROVIDED
```
