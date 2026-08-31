# S25 redacted inventory — Vercel dependency standalone repository

- Generated: 2026-08-27 02:50 HKT
- Session: `S25_ARCHIVE_ONLY`
- Repository classification: standalone Git repository nested inside a plain,
  ignored dependency-remediation container; it is not a registered worktree.
- Preservation status: `EXTERNAL_RECONSTRUCTION_VERIFIED / DO_NOT_DELETE`
- Inspection boundary: Git metadata, path names, file sizes, timestamps,
  checksums, and patch applicability only. No credential or private payload was
  read or retained.

## Identity

| Field | Value |
| --- | --- |
| Candidate path | `/Volumes/Starship/UAIS/.worktrees/.isolated-uas-dep-remediation-54.17.3-20260824/candidate` |
| Evidence path | `/Volumes/Starship/UAIS/.worktrees/.isolated-uas-dep-remediation-54.17.3-20260824/evidence` |
| Git directory | Standalone `.git/` directory |
| Checkout | Detached HEAD |
| HEAD | `d830c28ee21afedb95710451d843899bf4ee91db` |
| Local branch ref retained in clone | `main` at `0eb5f1dc44ccfb8d77c94cb1b6919f4236302c92` |
| `origin` classification | Local path `/Volumes/Starship/UAIS`, not GitHub |
| Base relationship | Detached HEAD is an ancestor of the root final-candidate tip |

## Dirty-state inventory

| Class | Count or result |
| --- | ---: |
| Staged paths | 0 |
| Unstaged tracked paths | 84 |
| Untracked files | 57 |
| Total status records | 141 |
| Tracked diff | 84 files; 356 insertions; 21,054 deletions |
| Untracked regular-file bytes | 754,627 |
| Sorted status/path-set SHA-256 | `849b37d6e51d9be52df31dda02794470f77f8d373d6c84682dd348e0e89aa2f0` |

### Redacted top-level distribution

| State | Top-level area | Count |
| --- | --- | ---: |
| Modified | package manifests | 2 |
| Modified | `src/` | 57 |
| Modified | `tests/` | 25 |
| Untracked | `src/` | 54 |
| Untracked | `tests/` | 3 |

## Redaction and secret boundary

- No dirty path name matched the conservative secret-risk filename classifier.
- No non-example `.env` file was present at the standard repository root
  locations checked.
- No `.vercel/` metadata directory was present.
- One ignored local AI-asset directory is present and occupies approximately
  4 KB. Its filenames and contents are excluded from this inventory and all
  proposed archive artifacts.

## Existing preservation evidence and independent verification

The parent evidence package already contains a full current-working-copy patch,
an exact 141-path manifest, a dependency-only patch, source bindings, and an
evidence checksum manifest. S25 independently re-ran the preservation checks:

| Evidence | Fresh result |
| --- | --- |
| Combined patch SHA-256 | `d7cfcf2b57023de63abfc03cde7d9b5453b56f1f186ccef91baf235a98ad7860` |
| Dependency-only patch SHA-256 | `e247f7b1c7054bab53fe1302cadc8dce3062c37660d1dbc8ac29fd4679a70c21` |
| Combined path-manifest SHA-256 | `1895a3ca472cab33e850eb1ba141ad4c92a13d69f273499198b9411bff132a2b` |
| Dependency path-manifest SHA-256 | `3a91d218beeaf6db0adeada91763ad528830a37c39fe81733e2f0b201ed47cb2` |
| Candidate `package.json` SHA-256 | `d61f96820cb8f723dd475d5bc6ea8abaf39f3da87fcbd5ecc64aff5575ccbf12` |
| Candidate `package-lock.json` SHA-256 | `ae7c407ab6fe0461f293413d6f26fb21918a014ab4a3a2e2e794f8ba9fcc89ab` |
| Path-manifest count | 141 |
| Current unique dirty-path count | 141 |
| Manifest/current path equality | PASS |
| Combined patch reverse-apply check | PASS |
| Evidence manifest | PASS: 182 OK, 0 failed |

The patch and manifest therefore describe the current candidate working copy,
not merely an older intention. A later explicitly authorized package at
`/Volumes/Starship/UAIS-archives/2026-08-27/dependency-remediation-54.17.3`
was cloned and reconstructed only from its external bundle and patch. All 141
approved hashes and source/reconstruction byte comparisons passed. The parent
directory still must not be deleted because exact-path Trash authorization is
separate.

## Relationship to other copies

- Compared with the current final-candidate working copy, 19 of 141 status
  paths are byte-identical and 122 are not byte-identical.
- The complete 141-path set is a subset of the invite-p95 standalone dirty set.
- Compared directly with the invite-p95 copy, 130 paths are byte-identical and
  11 differ.

## Disk composition

| Area | Approximate size | Preservation class |
| --- | ---: | --- |
| Candidate repository | 1.9 GB | External archive verified; retain until exact Trash authorization |
| Candidate `.git/` | 25 MB | Exact base/history now anchored externally; retain with original until Trash authorization |
| Candidate `node_modules/` | 1.0 GB | Regenerable; exclude |
| Candidate `.next/` | 774 MB | Regenerable; exclude |
| Parent `evidence/` | 356 MB | Review; preserve minimal verified evidence set |

## Preservation decision

This repository is locally and externally reconstructable. The minimal
external package contains the verified combined/dependency patches, path and
file-hash manifests, source binding, original evidence provenance, redacted
review, README, reconstruction receipt, and complete-history bundle. Its final
package manifest verifies 20/20 payload files with zero mismatches; independent
external-only reconstruction reproduces 141/141 paths byte-for-byte.

Cleanup remains unauthorized. The owner explicitly reserved moving this exact
source parent directory to Trash for a separate post-receipt decision. No
deletion, source move, or Trash emptying is implied by the verified copy.
