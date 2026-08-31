# S25 final source egress — third consecutive blocked audit

Date: 2026-08-27 (Asia/Hong_Kong)

## Decision

`BLOCKED_PENDING_EXACT_EGRESS_AUTHORIZATION`

This is the third consecutive goal turn with the same blocking condition.
The owner accepted the overall cleanup order and authorized a bounded
source-only preservation concept, but the current external-write boundary
still lacks an exact authorization binding all of the following current
facts in one acknowledgement:

- source staging directory
  `/private/tmp/uais-s25-final-source-overlay.gUnq3o/package`;
- destination
  `/Volumes/Starship/UAIS-archives/2026-08-27/final-source-overlay-376efeda`;
- pre-copy `PACKAGE-MANIFEST.sha256`
  `6006c6c7df67131eda814c5202384dbe083cb1a4c2bd3be66a99a4758cf2bfd5`;
- disclosure that approved source/test text contains references to 11
  excluded evidence filenames, while all 24 evidence/log files and their
  contents remain excluded;
- metadata-disabled transfer with no source-xattr preservation and a
  destination allowlist in which only host-generated
  `com.apple.provenance` may exist; all other xattr, AppleDouble,
  resource-fork, quarantine, and PAX/GNU extended-header counts must be zero;
- external-only reconstruction, reconstruction-receipt addition, final
  manifest regeneration, and final independent review;
- continued prohibition on Git, release, deployment, provider, database,
  production, and Trash-emptying actions.

An earlier escalated external-copy request was rejected before execution.
No attempt was made to bypass that decision.

## Third-audit evidence

- Pre-copy package manifest SHA-256 remains
  `6006c6c7df67131eda814c5202384dbe083cb1a4c2bd3be66a99a4758cf2bfd5`.
- All 11 covered package members verify; the package remains exactly 12
  top-level regular files.
- The independently reviewed execution packet remains byte-identical at
  SHA-256
  `5f0cdc2e36031ce65c7fd8e9e877f9dcd6f38bff2034c5d03af9e4f1cdea015a`.
- The exact incoming path
  `/Volumes/Starship/UAIS-archives/2026-08-27/.final-source-overlay-376efeda.incoming`
  is absent.
- The exact final target
  `/Volumes/Starship/UAIS-archives/2026-08-27/final-source-overlay-376efeda`
  is absent.
- The bound complete-history bundle remains present at SHA-256
  `f775b56c133f6c4b12ff10ceecaf463179b9a53cff9d2c8c25e77c3d726a97f1`.
- Final remains on
  `codex/p1-p2-integration-candidate-20260822-final` at
  `376efedae4a7ba4d86fb9a0ec2087a654b71170c`, with 19 modified tracked
  paths, 14 untracked paths, and zero staged paths.
- The 24-path evidence/log custody manifest resolves 24/24 paths in place.
- PIDs `60841`, `60842`, and `60848` remain absent.
- Release evidence remains `NO_GO / SOAK_NOT_ADMITTED /
  PRODUCTION_AUTHORIZATION=NO`.
- Git topology remains five local branches and four registered worktrees;
  `git worktree prune --dry-run --verbose` reports no stale entries.

## Why cleanup cannot safely continue

The remaining order is dependency-bound:

1. external source-only preservation and external-only reconstruction are
   not permitted without the exact acknowledgement above;
2. the 24 evidence/log paths are intentionally retained in place, so the
   final worktree is not clean;
3. no replacement S22 release disposition or accepted integration result
   exists;
4. P1 retains unique patches, the old candidate is patch-equivalent but
   non-ancestral, P2 is contained only by the unaccepted final, and final is
   dirty and rejected;
5. consequently no branch/worktree is eligible for ordinary non-force
   removal.

The task cannot progress through external copy, integration, or cleanup
without new owner input or a release-state change. Force deletion, reset,
clean, merge, commit, push, deployment, provider/database access, production
access, and Trash emptying remain prohibited.

## Resume gate

Resume only after the owner gives the exact authorization text recorded in:

`coordination/release-intake/2026-08-27-S25-final-source-overlay-egress-execution-packet.md`

After that authorization, re-run the complete pre-copy drift gate before any
write. If any bound hash, path, package member, candidate state, target
absence, or metadata contract has changed, stop and obtain a newly bound
authorization.

No source, evidence, Git ref, worktree, release, deployment, provider,
database, production, or Trash state was changed during this audit.
