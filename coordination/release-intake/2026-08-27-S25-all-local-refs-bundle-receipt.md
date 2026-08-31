# S25 all-local-refs complete-history bundle receipt

- Completed: 2026-08-27 15:35 HKT
- Session: `S25`
- Objective: close the committed-ref preservation gap before any future
  branch/worktree cleanup without changing any Git ref.
- Bundle:
  `/Volumes/Starship/UAIS-archives/2026-08-27/UAIS-S25-all-local-refs-20260827.bundle`
- Size: 26,307,308 bytes.
- SHA-256:
  `f775b56c133f6c4b12ff10ceecaf463179b9a53cff9d2c8c25e77c3d726a97f1`.
- Sidecar checksum:
  `/Volumes/Starship/UAIS-archives/2026-08-27/UAIS-S25-all-local-refs-20260827.bundle.sha256`.

## Explicit exported refs

| Ref | Exported object |
| --- | --- |
| `refs/heads/main` | `0eb5f1dc44ccfb8d77c94cb1b6919f4236302c92` |
| `refs/heads/codex/p1-learning-closed-loop` | `03283084426638c4d8d56e7483ce63a42bc30d3b` |
| `refs/heads/codex/p1-p2-integration-candidate-20260822` | `7c18bdcd1d81f5cb6b3e1f83695b84edc56bcc2b` |
| `refs/heads/codex/p1-p2-integration-candidate-20260822-final` | `376efedae4a7ba4d86fb9a0ec2087a654b71170c` |
| `refs/heads/codex/p2-quality-ux-a11y-ops` | `ebf0efa82b1fa2085a1bc719b6a4fb0e3bef9c8c` |
| `refs/tags/archive/uais/2026-08-27/p1-learning-closed-loop` | annotated tag object `81290f1501a4267c3c7ae2f77a5621f93b0ebabe` |
| `refs/tags/archive/uais/2026-08-27/p1-p2-integration-candidate-20260822` | annotated tag object `6ede5cd857e9f8c6224a8d398e4aace5e400c8f4` |
| `refs/tags/archive/uais/2026-08-27/standalone-base-d830c28` | annotated tag object `725a50eb7efcc6efdab0a196188bbe2641c2ae5b` |

`git bundle verify` reports eight refs, complete history, and SHA-1 object
format. `git bundle list-heads` returns each exact ref/object pair above.

## Stability checks

The bundle was written through a temporary file under the archive directory,
verified before rename, and then moved atomically to its final name. Before
and after creation:

- local branch-ref snapshot SHA-256 remained
  `f0f7d291eada0e26c5d6eb2344b3db172f3134711f9bfbf2a901dd6dfe6cba2f`;
- archive-tag snapshot SHA-256 remained
  `98f168b842fcae7d8c9ae6ea54bdc79863fce4b83024dec4bd85bcac787a51de`;
- registered-worktree snapshot SHA-256 remained
  `22be041ea8ac8436e6ca958fca344843bf66cf5e05e1c70d1be535d28cbee030`.

No branch, tag, worktree, index, remote ref, or production state was changed.

## Scope boundary

This bundle preserves committed Git history only. In particular, it does not
capture the final worktree's current 19 modified tracked files and 14
untracked files. Those paths remain in place and continue to require their own
owner classification, secret/private-data boundary, source-derived capture,
clean-candidate decision, and release disposition before any cleanup.

The latest current-candidate evidence remains bound to
`376efedae4a7ba4d86fb9a0ec2087a654b71170c` and still says
`NO_GO / SOAK_NOT_ADMITTED / PRODUCTION_AUTHORIZATION=NO`. Three orphaned
Playwright/WebKit processes (PIDs 60841, 60842, and 60848 at this check) also
retain their current directories under the final worktree's staging-a11y
output. They were observed read-only and were not terminated.

P1 and P2 registered worktrees were clean and had zero recursively open
processes. No open GitHub pull request existed. Local `main` remained one
commit ahead and zero behind live `origin/main`; its unpushed commit is
`0eb5f1dc44ccfb8d77c94cb1b6919f4236302c92`.

No product test, lint, or build was run because no product code was modified.
The evidence proves committed-ref preservation and topology stability only;
it does not prove application, CI, deployment, soak, accessibility, or
production readiness.
