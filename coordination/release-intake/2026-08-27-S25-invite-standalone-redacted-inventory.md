# S25 redacted inventory — invite-p95 standalone repository

- Generated: 2026-08-27 02:50 HKT
- Session: `S25_ARCHIVE_ONLY`
- Repository classification: standalone Git repository inside an ignored
  `.worktrees/` container; it is not registered by the root repository's
  `git worktree list`.
- Preservation status:
  `EXTERNAL_RECONSTRUCTION_VERIFIED / DO_NOT_DELETE`
- Inspection boundary: Git metadata, path names, file sizes, timestamps, and
  byte-equality results, plus a later counts/categories-only structural review
  of secret-shaped test literals. No credential value, local AI asset payload,
  private data row, environment-variable value, URL, host, password, key body,
  literal hash, or matched line was emitted or retained in durable evidence.

## Identity

| Field | Value |
| --- | --- |
| Path | `/Volumes/Starship/UAIS/.worktrees/.isolated-uais-invite-p95-20260824` |
| Git directory | Standalone `.git/` directory, not a linked-worktree pointer |
| Checkout | Detached HEAD |
| HEAD | `d830c28ee21afedb95710451d843899bf4ee91db` |
| HEAD subject | `Wire teacher-reviewed group suggestions` |
| HEAD date | 2026-08-23 18:13:03 HKT |
| Local branch ref retained in clone | `main` at `0eb5f1dc44ccfb8d77c94cb1b6919f4236302c92` |
| `origin` classification | Local path `/Volumes/Starship/UAIS`, not GitHub |
| Base relationship | Detached HEAD is an ancestor of the root final-candidate tip |

## Dirty-state inventory

| Class | Count or result |
| --- | ---: |
| Staged paths | 0 |
| Unstaged tracked paths | 139 |
| Untracked files | 112 |
| Total status records | 251 |
| Tracked diff | 139 files; 23,453 insertions; 22,712 deletions |
| Untracked regular-file bytes | 2,184,645 |
| Sorted status/path-set SHA-256 | `d0377562b10ae2f9b8f750888ae7fc5dd3d6b2f32cb3cd5d45e9857fe59dbf78` |

### Redacted top-level distribution

| State | Top-level area | Count |
| --- | --- | ---: |
| Modified | tracked environment example placeholder | 1 |
| Modified | `.gitignore` | 1 |
| Modified | `README.md` | 1 |
| Modified | `coordination/` | 10 |
| Modified | `docs/` | 3 |
| Modified | package manifests | 2 |
| Modified | `scripts/` | 5 |
| Modified | `src/` | 75 |
| Modified | `tests/` | 41 |
| Untracked | `coordination/` | 1 |
| Untracked | `migrations/` | 2 |
| Untracked | `scripts/` | 22 |
| Untracked | `src/` | 59 |
| Untracked | `tests/` | 28 |

## Redaction and secret boundary

- No non-example `.env` file was present at the standard repository root
  locations checked.
- No `.vercel/` metadata directory was present.
- Six dirty path names matched a conservative secret-risk filename classifier.
  This is a path-name warning, not evidence of a real credential. The matches
  include the tracked environment example and code/test names that describe
  credential or keychain contracts. Values were not opened or copied.
- One ignored local AI-asset directory is present and occupies approximately
  4 KB. Its filenames and contents are intentionally excluded from this
  durable inventory and from every proposed archive.
- `.tmp/`, ignored runtime assets, local environment files, provider metadata,
  and credential stores are excluded from the preservation plan unless the
  owner supplies a separate exact-path authorization.
- A subsequent structural audit resolved the five findings left open by the
  first contextual pass. Across the two affected test files at base and
  working-copy revisions, all 12 URL-shaped occurrences were classified as
  synthetic test fixtures; none remained review-required.
- A current scan of all 251 dirty regular files found one private-key begin
  marker in test code, zero end markers, zero complete blocks, and zero
  parseable private keys. See
  `2026-08-27-S25-invite-literal-safety-review.md` for method and limits.

## Relationship to other copies

- Compared with the current final-candidate working copy, 20 of the 251 dirty
  paths are byte-identical and 231 are not byte-identical. No path matched the
  committed final-candidate tip exactly under the comparison order used.
- All 141 dirty paths in the dependency-remediation standalone candidate are
  present in this repository's dirty path set.
- Of those 141 overlapping paths, 130 are byte-identical and 11 differ.
- This repository has 110 additional dirty paths not present in the dependency
  candidate.

These results prove that this directory is not a disposable duplicate. They do
not prove that every difference is promotable product work: the tree includes
verification projections, generated wrappers, evidence refreshes, and source
changes that require owner-by-owner reconciliation.

## Disk composition

| Area | Approximate size | Preservation class |
| --- | ---: | --- |
| Whole standalone repository | 2.6 GB | External archive verified; retain until exact Trash authorization |
| `.git/` | 25 MB | Exact base/history anchored externally; retain with original until Trash authorization |
| `node_modules/` | 1.1 GB | Regenerable; exclude from future archive |
| `.next/` | 1.4 GB | Regenerable; exclude from future archive |
| `output/` | 552 KB | Generated; review manifest before exclusion |
| Dirty untracked regular files | about 2.1 MB | Candidate preservation payload after review |

The newest safe, non-cache path timestamp observed was 2026-08-26 02:50 HKT.
No running process with this UAIS path in its command line was observed during
the intake, but that process check is not sufficient authority to delete it.

## Preservation decision

A later isolated reconstruction proved that the combined patch and manifest
recreate all 251 approved dirty paths byte-for-byte from exact base
`d830c28ee21afedb95710451d843899bf4ee91db`; `git diff --check` also passed.
The path manifest and file-hash manifest are recorded in
`2026-08-27-S25-standalone-reconstruction-receipt.md`.

An exact allowlisted external package was subsequently written to
`/Volumes/Starship/UAIS-archives/2026-08-27/invite-p95`. Its final package
manifest verifies 12/12 payload files with zero mismatches. A fresh checkout
cloned from the external bundle, patched from the external tracked patch, and
populated from the 112-file external tar reproduced all 251 approved paths and
source bytes with zero mismatches; `git diff --check` and `git fsck --full`
passed.

The repository still must remain in place because the owner explicitly
reserved exact-path Trash authorization for a separate post-receipt decision.
External reconstructability is not deletion or promotion authorization.
S22/S12/S13/S11/S10 owners must still reconcile the 110 invite-only paths and
11 overlapping-but-different paths before product promotion. The remaining
deletion and release gates are defined in
`2026-08-27-S25-archive-only-preservation-plan.md`.
