# S25 final source-overlay external preservation receipt

Date: 2026-08-27 (Asia/Hong_Kong)

## Result

`PASS — EXTERNAL_SOURCE_ONLY_PRESERVATION_COMPLETE`

The owner supplied an exact authorization binding the frozen task staging,
external target, pre-copy manifest digest, disclosed source filename
references, provenance-only metadata rule, external-only reconstruction,
receipt/final-manifest finalization, and continued Git/release/production
prohibitions.

## Frozen authorized inputs

| Binding | Value |
| --- | --- |
| Task staging | `/private/tmp/uais-s25-final-source-overlay.gUnq3o/package` |
| External target | `/Volumes/Starship/UAIS-archives/2026-08-27/final-source-overlay-376efeda` |
| Hidden incoming | `/Volumes/Starship/UAIS-archives/2026-08-27/.final-source-overlay-376efeda.incoming` |
| Pre-copy manifest SHA-256 | `6006c6c7df67131eda814c5202384dbe083cb1a4c2bd3be66a99a4758cf2bfd5` |
| Execution packet SHA-256 | `5f0cdc2e36031ce65c7fd8e9e877f9dcd6f38bff2034c5d03af9e4f1cdea015a` |
| Exact base | `376efedae4a7ba4d86fb9a0ec2087a654b71170c` |
| Tracked patch SHA-256 | `c4192989025d6a7a7de3db9cb690ffd4cd0dbb4213be8f34031c58cb73cff97c` |
| Untracked ustar SHA-256 | `db3c4f4a878481d18e8573a5260ff34a761f04853934450ab4e14b0c5e7ce993` |
| Complete-history bundle SHA-256 | `f775b56c133f6c4b12ff10ceecaf463179b9a53cff9d2c8c25e77c3d726a97f1` |

Fresh primary and independent pre-copy reviews reproduced every frozen
binding: 11/11 package checks, 12 regular staging members, 9/9 live source
hashes, 7+2 path partition, normalized two-member ustar, complete eight-ref
bundle, exact final HEAD, zero staged paths, 19+14 dirty count, 24/24 excluded
evidence paths in place, target/incoming absence, and provenance-only staging
xattr names.

## Metadata-disabled external copy

The staging package was copied to the exact hidden incoming directory by
explicitly naming all 12 files and using `COPYFILE_DISABLE=1` with `cp -X`.
No wildcard, archive extraction, broad sync, or pre-existing destination was
used.

Before publication, incoming verification proved:

- exactly 12 top-level regular files;
- no nested directory, symbolic link, or special object;
- directory mode `0700`, file modes `0600`;
- frozen pre-copy manifest SHA and 11/11 checks;
- valid package JSON;
- zero AppleDouble members;
- destination xattr names were a subset of `{com.apple.provenance}`;
- zero non-allowlisted xattrs, resource forks, or quarantine attributes.

The verified incoming directory was renamed on the same filesystem to the
exact external target. Post-rename verification proved the target realpath,
incoming absence, member set, manifest, modes, and metadata allowlist again.

## Primary external-only reconstruction

The primary task created
`/private/tmp/uais-s25-final-external-reconstruct.o0TKkQ`, cloned only from the
external complete-history bundle, checked out detached exact base, applied
the external binary patch, and extracted the external two-path ustar.

Final complete verification result:

| Check | Result |
| --- | --- |
| Detached HEAD | exact `376efeda...` |
| Tracked paths | `7/7`, exact |
| Untracked paths | `2/2`, exact |
| Combined paths | `9/9`, exact |
| Approved hashes | `9/9 PASS` |
| Byte equality against frozen final | `9/9 PASS` |
| Reconstructed tracked patch bytes | exact |
| Reverse patch applicability | `PASS` |
| Staged paths | `0` |
| `git diff --check` | `PASS` |
| `git fsck --full` | `PASS` |
| Disallowed metadata artifacts | `0` |

The first verifier-only attempt stopped because `cmp` is unavailable on this
host; a second stopped because the zsh-reserved variable `path` removed
`git` from that shell's command lookup. Both attempts were fail-closed and
changed neither the external package nor reconstruction bytes. The complete
verification was rerun from the beginning using `/usr/bin/diff -q` and a
non-reserved loop variable, producing the result above.

## External receipt and final manifest

After reconstruction passed, the source-derived receipt was copied with
metadata preservation disabled to:

`EXTERNAL-RECONSTRUCTION-RECEIPT.md`

Its SHA-256 is:

`45ea8d31530142006bca783aa01d54b35be001a4ec18b45def06b7599ee57185`

The external `PACKAGE-MANIFEST.sha256` was then atomically regenerated. Final
package state:

| Property | Final value |
| --- | --- |
| Target realpath | `/Volumes/Starship/UAIS-archives/2026-08-27/final-source-overlay-376efeda` |
| Top-level members | 13 regular files |
| Nested/symlink/special members | 0 |
| Manifest-covered non-self members | 12 |
| Manifest checks | `12/12 PASS` |
| Final manifest SHA-256 | `110845f7ff15cdb3eb2c2f21aa1362154cd40732f59451c3b742baf8a7a20c8f` |
| Directory/file modes | `0700` / `0600` |
| Unique filesystem xattr name | `com.apple.provenance` |
| Disallowed xattrs/AppleDouble | 0 / 0 |
| Hidden incoming | absent |

## Independent post-receipt review

An independent reviewer returned final `PASS` after checking the completed
13-member package and performing a new reconstruction in its own exact
task-scoped directory
`/private/tmp/uais-s25-independent-postreview.eRuQsI`.

The independent reconstruction used only the external bundle and package and
reproduced exact base, 7+2=9 paths, 9/9 hashes, 9/9 bytes, patch-byte equality,
reverse applicability, zero staged paths, diff-check, fsck, regular-file
types, and zero disallowed metadata artifacts. It rechecked the frozen final
HEAD and 9/9 live hashes afterward, confirmed the final manifest and receipt
had not drifted, then deleted and proved absence of its exact temporary
directory.

## Exclusion and authority boundary

- All 24 evidence/session-log paths remain 24/24 in the original final
  worktree under `RETAIN_IN_PLACE` custody.
- No evidence payload or evidence manifest is a member of the 13-file
  package.
- Approved source/test text retains the explicitly disclosed references to
  11 evidence filenames; no referenced evidence content is included.
- No real secret, `.env*`, `.vercel`, provider/database runtime material,
  private payload, database dump, dependency, build, cache, or ignored
  runtime output was copied.
- PIDs `60841`, `60842`, and `60848` remain absent.
- Final remains dirty and release evidence remains `NO_GO /
  SOAK_NOT_ADMITTED / PRODUCTION_AUTHORIZATION=NO`.
- No merge, commit, branch/worktree deletion, push, deployment,
  database/provider operation, production access, or Trash emptying occurred.

After this durable receipt was written and reverified, the primary
task-scoped reconstruction directory
`/private/tmp/uais-s25-final-external-reconstruct.o0TKkQ` was deleted and its
absence was verified. The external target remained present and its final
manifest remained
`110845f7ff15cdb3eb2c2f21aa1362154cd40732f59451c3b742baf8a7a20c8f`
after cleanup. The protected external package, existing bundle, task staging,
original final worktree, and all evidence paths were not removed or changed.
