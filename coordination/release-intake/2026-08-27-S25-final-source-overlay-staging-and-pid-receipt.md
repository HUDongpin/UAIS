# S25 final source-overlay staging and exact-PID termination receipt

- Checkpoint: 2026-08-27 16:53 HKT
- Session: `S25`
- Result: `LOCAL_STAGING_PASS / PID_TERM_PASS /
  EXTERNAL_COPY_BLOCKED_EXACT_TARGET_REAUTH_REQUIRED`.
- Scope: the owner authorized a final source-only preservation package for
  the existing nine-path allowlist and termination of exact PIDs 60841,
  60842, and 60848. The 24 evidence/session-log paths remain in-place custody.
  No release, merge, push, deployment, database, provider, production, branch,
  worktree, ref, or Trash mutation was authorized.

## Authorization interpretation

The actionable portions of the owner message were applied independently:

1. Build the approved source-only payload in a task-scoped directory and
   require exact-base reconstruction before external acceptance.
2. Because no new evidence package or Trash target was named, retain all 24
   evidence/session-log paths in place.
3. Terminate only the three named processes after an immediate PID-reuse
   identity check.
4. Do not invent the missing clean exact-SHA candidate or an S22 `GO` result.
5. Do not infer exact branch/worktree deletion targets while preservation and
   release/disposition gates remain open.

## Source and allowlist preflight

- Final worktree:
  `/Volumes/Starship/UAIS/.worktrees/p1-p2-integration-candidate-20260822`.
- Branch: `codex/p1-p2-integration-candidate-20260822-final`.
- Exact base: `376efedae4a7ba4d86fb9a0ec2087a654b71170c`.
- Current source state remained 19 modified tracked plus 14 untracked paths,
  zero staged paths.
- Approved source/test allowlist: 9 paths, SHA-256
  `f3071b07882cc0fb5bea12de0f25697c50a445a9070600bbc826f0dab7a04b60`.
- Working-file hash manifest: 9/9 pass; manifest SHA-256
  `c96e1530c7a8d5def4cf949f863b33260375449fcb7d66baaf9255b17fa57b64`.
- Split: seven tracked files and two untracked files; every member is a
  regular non-symlink text file.
- Excluded evidence set: 24 paths, SHA-256
  `9eefaf13d2593f3b0ccf520b6a3b28fb7c321497ca6972604e8ffc6ed1dd04af`.
  The source and evidence sets remain disjoint and their union remains the
  exact 33-path dirty set.
- The existing complete-history bundle remains 26,307,308 bytes, SHA-256
  `f775b56c133f6c4b12ff10ceecaf463179b9a53cff9d2c8c25e77c3d726a97f1`,
  with eight exported refs and complete history.

An independent read-only reviewer reproduced the exact 9/24 partition, 7/2
split, 9/9 hashes, zero symlink/non-regular members, and the prior
value-redacted literal-safety classification. High-confidence private-key,
AWS-key, GitHub-token, Bearer, credentialed-URL, and non-example-env-path
shape counts remain zero. The three broad assignment candidates remain
synthetic password test fixtures; no value was emitted.

## Task-scoped staging package

Protected staging path:

`/private/tmp/uais-s25-final-source-overlay.gUnq3o/package`

- Parent and package directory mode: `0700`.
- Package files: mode `0600`.
- Current top-level members: 12; zero symlinks and zero nested entries.
- `PACKAGE-MANIFEST.sha256` covers the other 11 members and verifies 11/11.
- Current package-manifest SHA-256:
  `6006c6c7df67131eda814c5202384dbe083cb1a4c2bd3be66a99a4758cf2bfd5`.
- Binary-capable seven-path patch:
  `final-tracked.binary.patch`, 86,261 bytes, SHA-256
  `c4192989025d6a7a7de3db9cb690ffd4cd0dbb4213be8f34031c58cb73cff97c`.
- Strict two-path untracked archive:
  `final-untracked-source.tar`, 24,576 bytes, SHA-256
  `db3c4f4a878481d18e8573a5260ff34a761f04853934450ab4e14b0c5e7ce993`.
- Patch path delta against `tracked-paths.txt`: zero.
- Tar path delta against `untracked-paths.txt`: zero.
- Tracked/untracked union delta against `approved-paths.txt`: zero.
- Raw ustar headers: exactly two total and two regular members; zero PAX/
  extended headers, AppleDouble members, traversal paths, or non-regular
  members.
- Both headers are host-metadata normalized to UID/GID `0`, owner/group
  labels `root`, and fixed mtime `946656000`.

The package currently contains the approved patch/archive, path and file-hash
manifests, exact source/bundle binding, redacted safety review, README, and
package metadata. It contains no 24-path evidence manifest or evidence
payload, no complete-history bundle duplicate, and no provider/database/
runtime material. The README reserves an
`EXTERNAL-RECONSTRUCTION-RECEIPT.md`; that member will be created only after
an actual external-only reconstruction, after which the final package
manifest must be regenerated and reverified.

Independent standards review caught and prevented two staging-only defects:
the first tar contained hidden AppleDouble members despite a two-line BSD tar
listing, and the first README described the future external receipt as already
present. The tar was regenerated as metadata-disabled ustar and verified by
raw header parsing; the README now explicitly distinguishes pre-copy staging
from the final post-reconstruction package. The reviewer also identified
sandbox-added `com.apple.provenance` xattrs. These are not package members;
the future external transfer must disable source-xattr copying and must reject
every destination xattr name except host-generated `com.apple.provenance`.

## Local staging reconstruction

A disposable clone was made only from the existing external complete-history
bundle, then detached at the exact base, patched, and populated from the
two-path tar:

- reconstructed HEAD: exact `376efeda...`;
- reconstructed dirty path delta against the nine-path allowlist: zero;
- reconstructed file hashes: 9/9 pass;
- reconstructed-vs-live byte mismatches: zero;
- `git diff --check`: zero output;
- `git fsck --full`: no error or fatal output.

This proves the staging payload is reconstructible. It is not the requested
external-copy reconstruction and does not convert final into a clean or
accepted candidate.

## Independent final pre-copy review

After the AppleDouble/README defects and ordinary tar-header metadata were
removed, an independent reviewer inspected the exact current package and
returned `PASS` for pre-copy staging, conditional on exact egress authority
and the documented metadata-disabled transfer gate.

The reviewer independently confirmed:

- 12 regular top-level members, zero nested/symlink/special objects;
- 11/11 non-self package-manifest hashes;
- current manifest SHA-256
  `6006c6c7df67131eda814c5202384dbe083cb1a4c2bd3be66a99a4758cf2bfd5`;
- current tar SHA-256
  `db3c4f4a878481d18e8573a5260ff34a761f04853934450ab4e14b0c5e7ce993`;
- exactly two normalized regular ustar headers and zero AppleDouble, PAX/GNU
  extended, traversal, link, special, or duplicate members;
- exact nine-path/hash manifests and 9/9 live source hashes;
- exact patch forward check against the base index and reverse check against
  final's dirty working tree;
- correct exact-base, bundle, exclusion, source-reference, and README receipt
  semantics.

The staging directory plus 12 files retain 13 sandbox-added
`com.apple.provenance` xattrs. They are explicitly outside the package member
model. A subsequent non-source probe proved that zero-xattr output is not
attainable in this Codex/macOS execution context: `cp -X`, metadata-disabled
`ditto`, and even a newly touched empty file all receive the same
`com.apple.provenance`; `xattr -d` returns zero but the attribute remains.
Therefore the executable gate is stricter about disclosure while remaining
attainable: the transfer must not copy source xattrs; destination xattr names
must be a subset of `{com.apple.provenance}`; every other xattr name,
AppleDouble/resource-fork member, quarantine attribute, and extended tar
header must have count zero. Content hashes remain independently bound by the
package manifest.

## External-copy policy boundary

The intended exact external target remains absent:

`/Volumes/Starship/UAIS-archives/2026-08-27/final-source-overlay-376efeda`

The proposed temporary incoming path also remains absent. The escalated copy
request was rejected before command execution because the external-write
reviewer requires a fresh statement that explicitly authorizes exporting
this exact internal source/test/patch payload to this exact archive path after
acknowledging the sensitive-source egress. No copy, partial incoming tree, or
target directory was created. No workaround was attempted.

Exact sufficient resume statement:

> I explicitly authorize Codex to export the current reviewed source-only
> package from
> `/private/tmp/uais-s25-final-source-overlay.gUnq3o/package` to
> `/Volumes/Starship/UAIS-archives/2026-08-27/final-source-overlay-376efeda`.
> I understand this copies internal source code, tests, patches, and
> source-derived metadata to that separate archive location. This
> authorization binds the current pre-copy `PACKAGE-MANIFEST.sha256` digest
> `6006c6c7df67131eda814c5202384dbe083cb1a4c2bd3be66a99a4758cf2bfd5`.
> I authorize a metadata-disabled transfer that does not preserve source
> extended attributes. I understand this macOS/Codex host automatically adds
> an immutable or regenerated `com.apple.provenance` attribute even to an
> empty newly created file. Acceptance therefore requires that
> `com.apple.provenance` be the only permitted destination xattr name and that
> every other xattr name, AppleDouble/resource-fork member, quarantine
> attribute, or extended tar header have count zero. The package must
> remain limited to the seven-path binary-capable patch, two-path allowlisted
> untracked tar, nine-path/hash manifests, exact-base and existing-bundle
> binding, redacted safety review, README/metadata, reconstruction receipt,
> and final package manifest. It must exclude all 24 evidence/log paths, real
> secrets, `.env*`, `.vercel`, provider/database/runtime metadata, private
> payloads, dependencies, builds, caches, and production operations. I
> authorize independent reconstruction from that external target in a
> task-scoped temporary directory.

## Exact-PID termination

Two read-only audits, including one independent reviewer, confirmed no PID
reuse immediately before signaling:

| PID | UID | Start | Basename | Parent | Cwd binding |
| ---: | ---: | --- | --- | ---: | --- |
| 60841 | 501 | 2026-08-22 20:45:42 HKT | `node` | 1 | exact final staging-a11y cwd |
| 60842 | 501 | 2026-08-22 20:45:42 HKT | `bash` | 60841 | exact final staging-a11y cwd |
| 60848 | 501 | 2026-08-22 20:45:42 HKT | `Playwright` | 60842 | exact final staging-a11y cwd |

The sandbox initially denied `ps`, so no signal was sent during that failed
attempt. After an approved out-of-sandbox identity recheck, one exact
child-to-parent signal command was executed:

`kill -TERM 60848 60842 60841`

Postconditions:

- all three exact PIDs are absent;
- recursive final-worktree cwd-holder count is zero;
- no process group was signaled;
- no `SIGKILL` was used;
- no PID was re-signaled.

This clears only the active-process/cwd blocker.

## Remaining release and cleanup disposition

All 24 evidence/session-log paths remain present and retain
`RETAIN_IN_PLACE` custody. Final remains 19+14 dirty at the same base and its
authoritative evidence remains:

- `NO_GO`
- `SOAK_NOT_ADMITTED`
- `PRODUCTION_AUTHORIZATION=NO`

Git topology remains five local branches, four registered worktrees, and zero
stale entries. P1 retains two unique patches; the old candidate remains
patch-equivalent but non-ancestral; P2 is only an ancestor of the unaccepted
final; final remains dirty and release-rejected. Therefore no branch or
registered worktree is currently eligible for ordinary non-force removal.

No source, evidence, process, Git, release, deployment, provider, database,
production, or Trash action occurred beyond the local task-scoped package
generation/reconstruction and the exact authorized `TERM` sequence described
above. No product test, lint, build, CI, or live-browser check was run.

After recording all probe and reconstruction results, five exact task-created
temporary targets were deleted: the non-source xattr probe, three disposable
reconstruction clones, and the normalized tar-source helper. The protected
pre-copy `package/` staging is the only retained task-scoped source-derived
directory, and its post-cleanup manifest remains 11/11 at SHA-256
`6006c6c7df67131eda814c5202384dbe083cb1a4c2bd3be66a99a4758cf2bfd5`.

## Independent review of the revised egress packet

An independent read-only reviewer returned `PASS` for the unchanged execution
packet whose SHA-256 is
`5f0cdc2e36031ce65c7fd8e9e877f9dcd6f38bff2034c5d03af9e4f1cdea015a`.
The review independently confirmed:

- the pre-copy package manifest is still
  `6006c6c7df67131eda814c5202384dbe083cb1a4c2bd3be66a99a4758cf2bfd5`
  and validates 11/11 covered members;
- the package contains exactly 12 top-level regular files and no nested,
  symbolic-link, or special members;
- the untracked tar digest is
  `db3c4f4a878481d18e8573a5260ff34a761f04853934450ab4e14b0c5e7ce993`
  and its two approved regular ustar members use normalized `0/0`,
  `root/root`, and mtime `946656000` headers;
- the nine-path, seven-plus-two split, source hashes, base binding, bundle
  binding, patch direction checks, and current-worktree reverse check agree;
- the only staging xattr name is host-generated `com.apple.provenance`, and
  the packet correctly requires a metadata-disabled transfer, permits only a
  destination xattr-name subset of `{com.apple.provenance}`, and requires all
  other xattr, AppleDouble, resource-fork, quarantine, and PAX/GNU extended
  header counts to be zero;
- both the exact incoming path and final external target were absent during
  review.

This review is not egress authorization. It becomes stale if either the
package or the reviewed execution packet changes. No copy, extraction,
reconstruction, network access, Git mutation, release action, or production
operation occurred during the review.
