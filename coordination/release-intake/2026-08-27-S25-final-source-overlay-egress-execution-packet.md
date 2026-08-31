# S25 final source-overlay external-egress execution packet

- Frozen: 2026-08-27 17:11 HKT
- Session: `S25`
- Status: `WAITING_EXACT_EGRESS_AUTHORIZATION`
- Purpose: make the next authorized action deterministic and fail-closed;
  this packet does not itself authorize or perform external copying.

## Current pre-copy identity

| Binding | Required value |
| --- | --- |
| Staging directory | `/private/tmp/uais-s25-final-source-overlay.gUnq3o/package` |
| Staging top-level members | 12 regular files; no nested/symlink/special objects |
| Pre-copy manifest SHA-256 | `6006c6c7df67131eda814c5202384dbe083cb1a4c2bd3be66a99a4758cf2bfd5` |
| Manifest payload checks | 11/11 pass |
| Tracked patch SHA-256 | `c4192989025d6a7a7de3db9cb690ffd4cd0dbb4213be8f34031c58cb73cff97c` |
| Untracked ustar SHA-256 | `db3c4f4a878481d18e8573a5260ff34a761f04853934450ab4e14b0c5e7ce993` |
| Exact base | `376efedae4a7ba4d86fb9a0ec2087a654b71170c` |
| Complete-history bundle SHA-256 | `f775b56c133f6c4b12ff10ceecaf463179b9a53cff9d2c8c25e77c3d726a97f1` |
| External target | `/Volumes/Starship/UAIS-archives/2026-08-27/final-source-overlay-376efeda` |
| Temporary external incoming target | `/Volumes/Starship/UAIS-archives/2026-08-27/.final-source-overlay-376efeda.incoming` |

Any binding drift requires stopping before external write and producing a new
review and authorization packet.

## Source and disclosure boundary

- Exactly nine source/test paths: seven tracked paths in the binary-capable
  patch plus two untracked paths in the normalized ustar.
- Exactly 24 evidence/session-log files remain excluded and in-place.
- The approved source/test text contains references to 11 excluded evidence
  relative filenames. Those program/test references are retained to preserve
  byte equality; no excluded evidence file or evidence content is packaged.
- No real secret, `.env*`, `.vercel`, provider/database runtime evidence,
  private payload, database data/dump, dependency, build, cache, test-output
  tree, or other ignored runtime output is allowed.
- The transfer is preservation only; it grants no release, Git, remote,
  deployment, provider, database, production, or Trash authority.

## Verified macOS metadata behavior

A non-source README probe established:

1. the source staging file has only `com.apple.provenance`;
2. `COPYFILE_DISABLE=1 cp -X` preserves byte equality but the host still
   attaches `com.apple.provenance` to the destination;
3. `ditto --norsrc --noextattr --noqtn --noacl` also preserves bytes and
   creates only `com.apple.provenance`;
4. `xattr -d com.apple.provenance` returns success but the attribute remains;
5. a newly touched empty file receives the same attribute name and the same
   value hash as the source and both copy probes.

Zero destination xattrs are therefore not attainable in this Codex/macOS
execution context. The enforceable disclosure gate is:

- never copy source xattrs;
- destination xattr names must be a subset of
  `{com.apple.provenance}`;
- count of every other xattr name must be zero;
- AppleDouble, resource-fork, quarantine, PAX/GNU extended header, absolute,
  traversal, link, and special-member counts must all be zero;
- package member bytes remain bound separately by the package manifest.

## Authorized execution sequence

This sequence may run only after the owner explicitly authorizes the current
package identity and exact source/target above.

### 1. Fresh fail-closed preflight

- Reverify staging manifest 11/11 and exact manifest SHA-256.
- Reverify patch/tar hashes and the raw two-member normalized ustar contract.
- Reverify final HEAD, zero staged paths, 19+14 dirty count, nine live source
  hashes, and 24/24 evidence presence.
- Reverify the complete-history bundle checksum, eight refs, complete history,
  and final-ref-to-base binding.
- Resolve the archive-parent realpath and prove both incoming and final target
  are absent.

### 2. Metadata-disabled incoming copy

- Copy staging to the exact hidden incoming target with source resource forks,
  xattrs, quarantine information, and ACL preservation disabled.
- Do not use wildcard copy, archive expansion, broad sync, or a pre-existing
  target.
- Verify the incoming member set, 11/11 manifest, JSON, patch path set, raw tar
  headers, file modes, and no nested/symlink/special object.
- Walk every incoming object and fail if any xattr name other than
  `com.apple.provenance` exists.

### 3. Atomic publication

- Rename the completely verified incoming directory to the exact final target
  on the same filesystem.
- Verify final target realpath, incoming absence, member set, package
  manifest, and xattr-name allowlist again.

### 4. External-only reconstruction

- Create a new task-scoped temporary directory.
- Clone only from the separately bound external complete-history bundle.
- Check out detached exact base `376efeda...`.
- Apply the external target's tracked patch and extract only its two-path ustar.
- Prove reconstructed dirty-path equality, 9/9 file hashes, 9/9 byte equality
  against the still-frozen final worktree, zero metadata artifacts,
  `git diff --check`, and `git fsck --full`.

### 5. Final receipt and manifest

- Add `EXTERNAL-RECONSTRUCTION-RECEIPT.md` only after every external-only
  reconstruction check passes.
- Regenerate `PACKAGE-MANIFEST.sha256` to cover the new receipt and every other
  non-self member.
- Reverify all final payload hashes, allowed member names, JSON, raw tar,
  external bundle binding, and destination xattr-name allowlist.
- Obtain a final independent post-receipt review before calling the external
  package complete.

### 6. Temporary cleanup

- Remove only the exact task-created reconstruction/probe directories after
  their results are durably recorded.
- Do not remove final's source worktree, the 24 evidence paths, the external
  package, the bundle, any registered worktree/branch, or any Trash recovery
  batch.

## Immediate stop conditions

- Any staging/live source/manifest/base/bundle drift.
- Any unexpected package, patch, tar, or xattr member.
- Any target or incoming path already exists.
- Any reconstruction path/hash/byte mismatch.
- Any diff-check/fsck failure.
- Any action would require copying the excluded evidence set or other
  non-source runtime material.
- Any attempt would enter merge, commit, branch/worktree deletion, push,
  deployment, database, provider, production, or Trash-emptying scope.

## Current task-temp custody

After the probe and three local reconstruction results were durably recorded,
the exact non-source probe directory, three disposable reconstruction clones,
and normalized tar-source helper were deleted from `/private/tmp`. The only
retained task-scoped source-derived directory is the exact pre-copy package:

`/private/tmp/uais-s25-final-source-overlay.gUnq3o/package`

Its post-cleanup package-manifest verification remains 11/11 at the frozen
`6006c6c7...` digest above.

## Exact owner authorization required

> I explicitly authorize Codex to export the currently reviewed source-only
> package from
> `/private/tmp/uais-s25-final-source-overlay.gUnq3o/package` to
> `/Volumes/Starship/UAIS-archives/2026-08-27/final-source-overlay-376efeda`.
> I understand this copies UAIS internal source code, tests, patches, and
> source-derived metadata to that separate archive location. This
> authorization binds pre-copy `PACKAGE-MANIFEST.sha256`
> `6006c6c7df67131eda814c5202384dbe083cb1a4c2bd3be66a99a4758cf2bfd5`.
> I understand the approved source/test text contains program/test references
> to 11 excluded evidence filenames, but the 24 evidence/log files and their
> contents remain excluded. I authorize a metadata-disabled transfer that
> does not preserve source xattrs. I understand this host automatically adds
> `com.apple.provenance`; it may be the only destination xattr name, and every
> other xattr name, AppleDouble/resource-fork member, quarantine attribute, or
> extended tar header must have count zero. I authorize external-only
> task-scoped reconstruction, addition of the reconstruction receipt, final
> manifest regeneration, and final package review. This authorization does
> not permit merge, commit, branch/worktree deletion, push, deployment,
> database/provider/production action, Trash emptying, or copying any excluded
> evidence/runtime/secret material.
