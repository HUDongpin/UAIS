# S25 standalone-repository reconstruction receipt

- Date: 2026-08-27 (Asia/Hong_Kong)
- Session: `S25`
- Scope: local reconstruction followed by explicitly authorized external
  second-location packaging and external-only isolated reconstruction. No Git
  remote, deployment, environment, database, or production mutation.

## Exact-base anchor

- Local annotated tag:
  `archive/uais/2026-08-27/standalone-base-d830c28`
- Tag object: `725a50eb7efcc6efdab0a196188bbe2641c2ae5b`
- Peeled commit: `d830c28ee21afedb95710451d843899bf4ee91db`
- Complete-history base bundle: generated and verified locally in a
  task-scoped temporary staging directory.
- Remote state: unchanged; the tag was not pushed.

## Dependency-remediation candidate

| Check | Result |
| --- | --- |
| Exact base checkout | PASS |
| Combined patch SHA-256 | `d7cfcf2b57023de63abfc03cde7d9b5453b56f1f186ccef91baf235a98ad7860` |
| Expected path count | 141 |
| Reconstructed path count | 141 |
| Path-manifest SHA-256 | `1895a3ca472cab33e850eb1ba141ad4c92a13d69f273499198b9411bff132a2b` |
| Source/reconstruction file-hash-manifest SHA-256 | `25fd7d3a53f0c27e1bf5a8bb21b5df3a3386dd5ae500a9143aa16e3ef618324f` |
| Byte equality across all approved paths | PASS |
| `git diff --check` | PASS |
| Reconstructed `package.json` SHA-256 | `d61f96820cb8f723dd475d5bc6ea8abaf39f3da87fcbd5ecc64aff5575ccbf12` |
| Reconstructed `package-lock.json` SHA-256 | `ae7c407ab6fe0461f293413d6f26fb21918a014ab4a3a2e2e794f8ba9fcc89ab` |
| Local reduced-archive manifest | PASS |
| External second-location copy | PASS at exact authorized path |
| Final external package payload verification | PASS: 20/20, 0 mismatches |
| External-only reconstruction | PASS: 141/141 hashes and byte equality |
| Final package-manifest SHA-256 | `ed150df3dfa3086a4d17977d30c3113f00b16e991251e19381dd2968313fb21b` |

After the owner provided exact payload/path authorization, the package was
written to
`/Volumes/Starship/UAIS-archives/2026-08-27/dependency-remediation-54.17.3`
and reconstructed from its own external bundle and patch. The reconstructed
141-path set, approved-file hashes, package hashes, `git diff --check`, and
`git fsck --full` all passed. The original standalone remains intact because
source-directory Trash authorization is still separate.

## Invite-p95 candidate

| Check | Result |
| --- | --- |
| Exact base checkout | PASS |
| Combined patch SHA-256 | `495b6c638bbd0572697d1f6a609a5d97558e0021b707b3266bf92c75d5357063` |
| Expected path count | 251 |
| Reconstructed path count | 251 |
| Path-manifest SHA-256 | `821dc26c60ed2f23c6a0056966eabf192d1e412ad882589995b68c2f0e25108f` |
| Source/reconstruction file-hash-manifest SHA-256 | `80b7b50b4e801a84556900dd08c6163c92d2551fc257a08e25b56015a94c3291` |
| Byte equality across all approved paths | PASS |
| `git diff --check` | PASS |
| Ignored/local payload included | NO |
| First redacted secret-risk scan | REVIEW_REQUIRED: 44 high-confidence patterns; no candidate values emitted |
| First contextual redacted review | 5 database-URL patterns remained conservatively unresolved |
| Base/working-copy literal structure audit | PASS: 12/12 occurrences structurally synthetic; 0 review-required |
| Current 251-file private-key structure scan | PASS: 1 test begin marker; 0 end markers; 0 complete blocks; 0 parseable keys |
| Current disposition | `EXTERNAL_RECONSTRUCTION_VERIFIED / DO_NOT_DELETE` |
| External copy | PASS at exact authorized path |
| External tracked patch SHA-256 | `3acd81550e3bdb7882fafa32d9ee2b1fa8fd918872eca34a3726c517a32dfad4` |
| External untracked tar SHA-256 | `92af05057cebe4147d5bddd0cb6070bc0be4e6d8e870ee977f7db4b37a1dbbf7` |
| Final external package payload verification | PASS: 12/12, 0 mismatches |
| External-only reconstruction | PASS: 251/251 hashes and byte equality |
| Final package-manifest SHA-256 | `21f780f9f2146fd0a567ef69c330c801c2732d63ba9ea83a3c62c4d6df6ccbed` |

The five previously unresolved patterns were confined to two test files. A
follow-up counts/categories-only structural audit examined all URL-shaped
occurrences in those files at the base and working-copy levels: eight were
complete low-entropy test fixtures and four were credential-free literals used
only by fixture/evidence fingerprint helpers. The durable review is
`2026-08-27-S25-invite-literal-safety-review.md`. No URL, user, password, host,
database name, token, DSN, key body, literal hash, or matched line was logged.

The exact allowlisted package was subsequently written to
`/Volumes/Starship/UAIS-archives/2026-08-27/invite-p95` and reconstructed only
from its external bundle, tracked patch, and 112-file untracked tar. The
reconstructed path set, approved-file hashes, byte comparison,
`git diff --check`, and `git fsck --full` all passed. This does not authorize
deletion; the original invite repository remains intact pending separate exact
Trash authorization.

## Cleanup disposition

- Dependency standalone: externally reconstructable and byte-verified; retain
  pending owner review and separate exact-path Trash authorization.
- Invite standalone: externally reconstructable, byte-verified, and
  structurally reviewed; retain pending owner review and separate exact-path
  Trash authorization.
- No standalone repository, registered worktree, or local branch was removed
  by this reconstruction package.
