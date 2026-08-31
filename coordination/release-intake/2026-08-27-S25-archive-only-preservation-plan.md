# S25 archive-only preservation plan

- Date: 2026-08-27 (Asia/Hong_Kong)
- Session: `S25_ARCHIVE_ONLY`
- Scope: preserve two exact committed branch tips; inventory two dirty
  standalone repositories; define a value-redacted reconstruction path.
- Explicitly forbidden in this package: deletion, merge, branch deletion,
  `main` push, any remote tag push, deployment, environment mutation, database
  mutation, production access, or worktree removal.

## 1. Exact committed-tip archive completed

Two local annotated tags now preserve the exact authorized tips:

| Local tag | Tag object | Peeled commit |
| --- | --- | --- |
| `archive/uais/2026-08-27/p1-learning-closed-loop` | `81290f1501a4267c3c7ae2f77a5621f93b0ebabe` | `03283084426638c4d8d56e7483ce63a42bc30d3b` |
| `archive/uais/2026-08-27/p1-p2-integration-candidate-20260822` | `6ede5cd857e9f8c6224a8d398e4aace5e400c8f4` | `7c18bdcd1d81f5cb6b3e1f83695b84edc56bcc2b` |

The tags are local only. The live GitHub remote was not changed.

An offline bundle was created outside the repository:

- Path: `/Volumes/Starship/UAIS-archives/2026-08-27/UAIS-S25-exact-branch-tips-20260827.bundle`
- Size: 25,665,679 bytes
- SHA-256: `34b3d0edeacd29593ab25fe632f5499c7e07aeb891c82908bc7e0a052995b820`
- `git bundle verify`: PASS; 2 refs; complete history; SHA-1 object format.
- `git bundle list-heads`: both annotated tag objects present.

This bundle preserves committed branch history only. It does not include any
uncommitted standalone-repository work.

## 2. Standalone repository disposition

| Repository | Current preservation state | Cleanup state |
| --- | --- | --- |
| Invite-p95 standalone, 251 dirty paths | No current self-contained exact-working-copy patch found | `QUARANTINE_REQUIRED`; retain whole directory |
| Dependency candidate, 141 dirty paths | Exact-base combined patch and 182-file evidence manifest freshly verified | `LOCAL_PATCH_VERIFIED`; retain until second-location copy and reconstruction pass |

## 3. Data-handling boundary

The future preservation package may contain only explicitly reviewed source,
tests, migrations, coordination reports, path manifests, patch files, hashes,
and base/ref metadata. It must exclude:

- real `.env*` files and all credential values;
- `.vercel/`, Keychain material, provider tokens, cookies, private keys, and
  authentication artifacts;
- ignored local AI assets and private payloads;
- `node_modules/`, `.next/`, compile caches, browser profiles, test temp trees,
  health-probe residue, and other regenerable runtime output;
- raw database rows, private research rows, or sensitive screenshots.

The inventory may record only a redacted category and count for a secret-like
path. It must never reproduce a value.

## 4. Invite-p95 preservation sequence

1. Freeze the current directory in place; do not stage, commit, clean, reset,
   switch, or remove anything.
2. Assign owners to the 110 invite-only dirty paths and the 11 paths that
   differ from the dependency candidate. Resolve whether each is product
   source, current evidence, historical evidence, generated projection, or
   private/local-only material.
3. Produce an explicit allowlisted path manifest. Run a filename-only secret
   risk pass, then a separately approved content scan that emits categories and
   line locations without values.
4. From exact base `d830c28...`, produce a binary-capable tracked patch plus an
   allowlisted untracked-source archive. Do not include ignored files.
5. Anchor the exact base and local `main@0eb5f1dc...` in a dedicated quarantine
   bundle or annotated refs so garbage collection cannot remove prerequisites.
6. Reconstruct into a clean isolated directory, verify the path manifest and
   approved file hashes, run `git diff --check`, and run owner-selected tests.
7. Only after an independent reviewer signs the reconstruction receipt may
   S25 propose a separate exact-path Trash/removal authorization.

## 5. Dependency-candidate preservation sequence

1. Retain the current parent directory until duplication is complete.
2. Copy the verified minimal evidence set to a second archive location:
   combined patch, dependency-only patch, both changed-path manifests,
   source-binding/hash metadata, evidence manifest, and evidence README.
3. Anchor base `d830c28...` in the same archive or a complete-history bundle.
4. Verify copied hashes against the current values recorded in the redacted
   inventory.
5. Reconstruct exact base plus the combined patch in a clean isolated checkout.
   Confirm 141 paths, package hashes, `git diff --check`, and the narrow
   dependency verification described by the evidence README.
6. Keep the full 356 MB evidence directory until the minimal archive and
   reconstruction receipt have been independently reviewed.
7. Request deletion authorization separately; no removal is implied here.

## 6. Cleanup gates

No standalone directory is deletable until every applicable gate is PASS:

| Gate | Required evidence |
| --- | --- |
| Owner classification | Every dirty path mapped to owner and disposition |
| Secret boundary | No real secret/private payload included |
| Exact base | Base commit present in archive and resolves correctly |
| Working-copy capture | Manifest and patch/archive cover every approved path |
| Hash verification | Copied artifacts match recorded SHA-256 values |
| Reconstruction | Fresh isolated reconstruction reproduces approved paths |
| Review | Independent reviewer accepts the receipt |
| Authorization | Owner names the exact directory allowed to move to Trash |

Until then, `git clean`, `git reset --hard`, `git worktree remove --force`, raw
recursive deletion, wildcard branch deletion, and bulk staging remain forbidden.

## 6a. Subsequent execution update — 2026-08-27 12:10 HKT

This archive-only plan records the earlier intake state. Under the owner's
later cleanup-order authorization, S25 subsequently completed the following
local checks without deleting either standalone repository:

- invite combined-patch reconstruction: 251/251 approved dirty paths,
  byte-for-byte PASS from exact base `d830c28...`;
- dependency combined-patch reconstruction: 141/141 approved dirty paths,
  byte-for-byte PASS from the same exact base;
- invite literal-safety review: 12/12 base/working-copy URL-shaped test
  occurrences structurally synthetic, zero review-required; and
- invite private-key structure review: one begin marker in test code, zero end
  markers, zero complete blocks, zero parseable keys.

The invite row in section 2 is therefore superseded by
`LOCAL_RECONSTRUCTION_AND_LITERAL_SAFETY_VERIFIED / DO_NOT_DELETE`. The exact
results and boundaries are recorded in
`2026-08-27-S25-standalone-reconstruction-receipt.md` and
`2026-08-27-S25-invite-literal-safety-review.md`.

The exact allowlisted second-location source/patch copies were later
authorized and independently reconstructed from their external bundle/patch
inputs. Dependency reproduced 141/141 paths and invite reproduced 251/251
paths with zero hash or byte mismatches. The deletion gate nevertheless
remains closed because the owner explicitly reserved exact-path Trash
authorization for a separate post-receipt decision. This update does not alter
the no-force and no-production rules above.

## 7. Dirty-map tooling note

The required command was attempted with reason
`S25 archive-only exact-tip tags bundle and redacted standalone inventory`.
`scripts/release-dirty-map.mjs` calls `execFileSync` on
`git status --porcelain=v1 --untracked-files=all`; the root's millions of
`.scratch` cache entries exceeded the child-process buffer and produced
`spawnSync git ENOBUFS`. No dirty-map file was created. This package therefore
uses bounded top-level root status plus standalone-repository status counts and
path-set digests. The script failure is not a clean-tree result and does not
authorize cleanup.
