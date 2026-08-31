# S25 UAIS remote-heads read-only audit after local consolidation

- Date: 2026-08-31 (Asia/Hong_Kong)
- Scope: live read-only `origin` head inventory after local branch/worktree consolidation
- Remote mutation: none

## Live heads

| Live head | Exact SHA | Relation to local `main` | Local branch after cleanup |
| --- | --- | --- | --- |
| `main` | `fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541` | exact canonical head | retained |
| `codex/final-source-overlay-integration-376efeda-20260827` | `540dc39f5b8ed9f5b5f4898296dc58c94f1a3692` | contained by `main` | retired locally |
| `codex/soak-admission-provenance-hardening-540dc39` | `be0a5eb3e662e2f09530124bea77f77c7654f681` | contained by `main` | retired locally |
| `codex/uais-transcript-cas-80a-20260830` | `fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541` | exact alias of `main` | retired locally |
| `codex/uais-transcript-cas-80a-20260830-integration` | `fa1fd14d6ec4804b6eefdd612d0a56c8ec30e541` | exact alias of `main` | retired locally |

Fresh `git ls-remote --heads origin` returned exactly these five heads. No remote branch, tag, PR, deployment, or production state was changed.

## Separate future remote-cleanup gate

Remote cleanup remains a separate package. Before any remote deletion, refresh:

- live head SHA;
- current PR/owner disposition;
- ancestry and patch-equivalence;
- archive tag and bundle coverage;
- protected-main/release impact;
- exact SHA-lease deletion authorization.

This report does not authorize `git push --delete` or any remote mutation.
