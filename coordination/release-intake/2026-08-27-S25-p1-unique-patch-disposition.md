# S25 P1 patch-unique disposition

Date: 2026-08-27 (Asia/Hong_Kong)

## Decision

| Commit | Content disposition | Git cleanup disposition |
| --- | --- | --- |
| `19c6774241227a1688b0d229acc643bbb5c18514` | `SEMANTICALLY_SUPERSEDED — DO_NOT_BLIND_CHERRY_PICK` | retain P1 ref |
| `03283084426638c4d8d56e7483ce63a42bc30d3b` | `CONTENT_ALREADY_IN_FINAL_OR_STRICT_SUPERSET` | retain P1 ref until ordinary ancestry exists |

The P1 branch has six patch-equivalent commits and two patch-unique commits
relative to final. Patch uniqueness does not establish missing product
content; the two unique commits require content-level review.

## Preservation

The complete-history bundle contains the exact P1 branch ref:

`03283084426638c4d8d56e7483ce63a42bc30d3b refs/heads/codex/p1-learning-closed-loop`

Bundle SHA-256:

`f775b56c133f6c4b12ff10ceecaf463179b9a53cff9d2c8c25e77c3d726a97f1`

Therefore both unique commits and their ancestry are independently
recoverable even while the live P1 branch is retained.

## Commit `19c677...`

Purpose: guarded P1 validation lanes and environment catalog.

Paths:

- `.env.local.example`
- `docs/env-surface.md`
- `package.json`
- `scripts/run-db-tests.mjs`
- `scripts/run-p1-load-test.mjs`
- `src/lib/release/env-surface.ts`
- `tests/env-surface.test.ts`

A patch reconstructed directly from this commit has SHA-256
`8b606d8fcd11edd4f1ad760dd352aeca5377c5ed1e857bf2bfd39da13e8df035`.
It does not apply to a clean `376efeda...` tree:

- all five modified-file hunks conflict with later content;
- both originally added runner scripts already exist;
- all seven final blobs differ from their `19c677...` versions.

The intended surface is nevertheless present in the final commit:

- `UAIS_LEARNING_RECORD_OUTBOX_SECRET` appears in the env example,
  environment documentation, catalog, and tests;
- `UAIS_LEARNING_FEEDBACK_AI_ENABLED` appears in the same current surfaces;
- `package.json` retains `test:p1`, guarded `test:db`, `test:load:p1`, and
  `db:preflight:p1` lanes;
- the two runner scripts evolved from their original 81/90-line forms into
  substantially larger current guarded runners with capability, database
  identity, live-mutation, diagnostic, and fail-closed controls.

The current seven-file implementation differs from the historical commit by
2,045 insertions and 169 deletions. It is a later implementation, not a
missing clean application of the old patch. Blind cherry-pick would conflict
and risk replacing current safety controls. The historical commit should be
treated as semantically superseded unless a future owner-authorized functional
audit identifies one exact missing behavior.

## Commit `032830...`

Purpose: bind P1 acceptance evidence to its candidate SHA.

Paths:

- `coordination/reports/2026-08-21-p1-acceptance-ledger.md`
- `coordination/reports/2026-08-21-p1-local-validation.md`
- `coordination/session-logs/2026-08-21-S12.md`
- `coordination/session-logs/2026-08-22-S25.md`

A reconstructed patch has SHA-256
`0b5716fa2917d1b0f1f6b13f6d1e684b51cda24b8a68851a658c11ef663a24d6`.

At `376efeda...`:

- the first three files have byte-identical Git blob IDs;
- `coordination/session-logs/2026-08-22-S25.md` contains the P1 version plus
  154 later lines and zero deletions relative to `032830...`.

Thus this commit's evidence content is already present or strictly extended
in final. It is not a missing integration patch and should not be applied
again.

## Cleanup consequence

Content review removes the two P1 patch-unique commits as a reason to add
historical changes to a future clean candidate. It does not create Git
ancestry: `codex/p1-learning-closed-loop` remains non-ancestral to final, so
ordinary `git branch -d` would still refuse it.

Because merge, ref rewriting, force deletion, and branch deletion are not
authorized, the correct current action is to retain the clean P1 worktree and
branch as a recovery ref. A later accepted integration may create ordinary
ancestry; otherwise the branch can remain archived alongside the complete-
history bundle.

The task-scoped extracted-tree and patch-review directory was deleted after
the checks. No workspace file, Git ref/worktree, external archive, release, or
production state was changed.
