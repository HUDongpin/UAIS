# S25 external preservation and reconstruction receipt

- Verified: 2026-08-27 12:39 HKT
- Session: `S25`
- Authorization: exact two-package source-derived external copy and
  task-scoped reconstruction, with source deletion, Trash emptying, merge,
  push, deployment, database migration, provider mutation, and production
  changes explicitly excluded.

## Source freeze

Both source standalones remained detached at exact base
`d830c28ee21afedb95710451d843899bf4ee91db` before packaging. No matching
writer process or open file handle was found.

| Candidate | Dirty state | Path-set SHA-256 | Approved-file-manifest SHA-256 | Drift result |
| --- | --- | --- | --- | --- |
| Dependency remediation | 84 modified + 57 untracked = 141 | `1895a3ca472cab33e850eb1ba141ad4c92a13d69f273499198b9411bff132a2b` | `25fd7d3a53f0c27e1bf5a8bb21b5df3a3386dd5ae500a9143aa16e3ef618324f` | Exact match to prior receipt |
| Invite p95 | 139 modified + 112 untracked = 251 | `821dc26c60ed2f23c6a0056966eabf192d1e412ad882589995b68c2f0e25108f` | `80b7b50b4e801a84556900dd08c6163c92d2551fc257a08e25b56015a94c3291` | Exact match to prior receipt |

## Dependency-remediation external package

- Path:
  `/Volumes/Starship/UAIS-archives/2026-08-27/dependency-remediation-54.17.3`
- Final filesystem files: 21 (`20` payload files plus the self-excluded package
  manifest).
- Logical size: 26,920 KiB.
- Final `PACKAGE-MANIFEST.sha256` SHA-256:
  `ed150df3dfa3086a4d17977d30c3113f00b16e991251e19381dd2968313fb21b`.
- Package verification: 20/20 payload hashes, zero mismatches.
- Complete-history bundle SHA-256:
  `82b2506da5eb253928ad250268d73e2c356ffea1358365848ee47ff8c5bde2e1`;
  two refs, complete history, verification PASS.
- Combined patch SHA-256:
  `d7cfcf2b57023de63abfc03cde7d9b5453b56f1f186ccef91baf235a98ad7860`.
- Dependency-only patch SHA-256:
  `e247f7b1c7054bab53fe1302cadc8dce3062c37660d1dbc8ac29fd4679a70c21`.

External-only reconstruction result:

| Check | Result |
| --- | --- |
| Bundle clone and detached exact base/tree | PASS |
| Combined patch preflight/apply | PASS |
| Reconstructed dirty paths | 141 = 84 modified + 57 untracked |
| Reconstructed path-set SHA-256 | Exact expected value |
| External approved-file hashes | 141/141, zero mismatches |
| Original/reconstruction byte comparison | 141/141, zero mismatches |
| `git diff --check` | PASS |
| `git fsck --full` | PASS |
| Reconstructed package manifest hashes | Both exact expected values |

## Invite-p95 external package

- Path: `/Volumes/Starship/UAIS-archives/2026-08-27/invite-p95`.
- Final filesystem files: 13 (`12` payload files plus the self-excluded package
  manifest).
- Logical size: 29,468 KiB.
- Final `PACKAGE-MANIFEST.sha256` SHA-256:
  `21f780f9f2146fd0a567ef69c330c801c2732d63ba9ea83a3c62c4d6df6ccbed`.
- Package verification: 12/12 payload hashes, zero mismatches.
- Complete-history bundle SHA-256:
  `82b2506da5eb253928ad250268d73e2c356ffea1358365848ee47ff8c5bde2e1`;
  two refs, complete history, verification PASS.
- Tracked binary patch SHA-256:
  `3acd81550e3bdb7882fafa32d9ee2b1fa8fd918872eca34a3726c517a32dfad4`.
- Untracked-source tar SHA-256:
  `92af05057cebe4147d5bddd0cb6070bc0be4e6d8e870ee977f7db4b37a1dbbf7`.
- Tar path count: 112; tar path-list SHA-256 exactly matches
  `untracked-paths.txt` at
  `799374780bfd614c4b025fe75e0e91e396f5e0f0364a80f855e5492075b4b28f`.

External-only reconstruction result:

| Check | Result |
| --- | --- |
| Bundle clone and detached exact base/tree | PASS |
| Tracked patch preflight/apply | PASS |
| Untracked tar extraction | PASS |
| Reconstructed dirty paths | 251 = 139 modified + 112 untracked |
| Reconstructed path-set SHA-256 | Exact expected value |
| External approved-file hashes | 251/251, zero mismatches |
| Original/reconstruction byte comparison | 251/251, zero mismatches |
| `git diff --check` | PASS |
| `git fsck --full` | PASS |

## Exclusions and evidence boundary

The generated path manifests reject `.git`, `.next`, `.vercel`, `.tmp`,
`.scratch`, `.health-probes`, `node_modules`, path traversal, symlinks,
non-regular files, and non-example environment-shaped files. The packages do
not contain the excluded real credentials/provider metadata, Keychain/cookies,
private payloads, database data/dumps, local AI assets, caches, build output,
or ignored runtime trees. Invite's tracked `.env.local.example` remains an
explicit source placeholder, not a live environment file.

No product test/build was rerun from the minimal external packages because
dependencies and builds are intentionally excluded. The receipt proves exact
external reconstructability, path/hash integrity, and byte identity only; it
does not supersede release, production, provider-live, or browser gates.

## Deletion boundary

Both original standalone directories remain in place and unchanged. This
receipt satisfies the external-copy and reconstruction gate, but the owner
explicitly reserved original-directory Trash authorization for a separate
post-review decision. No original standalone source directory was moved or
deleted, and no Trash location was emptied.

The task-scoped staging/reconstruction directory under `/private/tmp` was
225,728 KiB before cleanup. Direct recursive deletion was rejected by the
local safety policy, so S25 did not bypass it. The exact task-owned directory
was moved recoverably to
`/Users/dongpinhu/.Trash/UAIS-S25-preservation-temp-20260827-1239`; its original
`/private/tmp` path is absent. That Trash location has not been emptied and is
not one of the original standalone source directories.
