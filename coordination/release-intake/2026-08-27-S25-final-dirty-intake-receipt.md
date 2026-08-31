# S25 final dirty-worktree redacted intake receipt

- Completed: 2026-08-27 15:43 HKT
- Session: `S25`
- Worktree:
  `/Volumes/Starship/UAIS/.worktrees/p1-p2-integration-candidate-20260822`
- Branch: `codex/p1-p2-integration-candidate-20260822-final`
- Exact committed base: `376efedae4a7ba4d86fb9a0ec2087a654b71170c`.
- Scope: read-only filename/type/size/hash intake. No source/evidence copy,
  patch, tar, staging, commit, branch/ref mutation, process termination,
  worktree removal, merge, push, deployment, database action, provider call,
  production access, or Trash emptying.

## Stable path partition

The current worktree contains 19 modified tracked paths and 14 untracked paths,
33 total. All 33 are regular, non-symlink files.

| Set | Paths | Bytes | Path-list SHA-256 | Disposition |
| --- | ---: | ---: | --- | --- |
| Entire dirty set | 33 | 627,302 | `e645011bbe087708a7bd35a0e4bb10e7b9b87e20c4928c564ff95a2b87b9e8e0` | Freeze; do not clean |
| Source/test overlay | 9 | 298,017 | `f3071b07882cc0fb5bea12de0f25697c50a445a9070600bbc826f0dab7a04b60` | Potential source-derived package after exact approval and remaining review |
| Coordination evidence/logs | 24 | 329,285 | `9eefaf13d2593f3b0ccf520b6a3b28fb7c321497ca6972604e8ffc6ed1dd04af` | Quarantine in place; no copy under current authority |

The source/test overlay contains seven modified tracked files and two
untracked files. The coordination set contains 18 reports and six session
logs, split 12 tracked and 12 untracked. The two path manifests are disjoint
and their union is exactly the 33-path dirty set.

Machine-verifiable manifests:

- `2026-08-27-S25-final-dirty-source-paths.txt`
- `2026-08-27-S25-final-dirty-source-files.sha256`
- `2026-08-27-S25-final-dirty-evidence-quarantine-paths.txt`

## Source/test overlay binding

| State | Bytes | Working-copy SHA-256 | Path |
| --- | ---: | --- | --- |
| Modified | 15,994 | `b19a1e7acce5023277f9833dc45d5fc97b22eed5a7ddea8587fe167ec0932b52` | `scripts/lib/p2-load-ramp.mjs` |
| Untracked | 12,243 | `7c1339a22db0c1aa4fe020ccb72e2ef3a8b7de2309e82b364b36ea16a0eafe40` | `scripts/p2-soak-admission-gate.mjs` |
| Modified | 46,277 | `2c74b93eaeb5db45c315a63bd252ac39326e787fc0418583b626acab98419467` | `src/lib/learning-loop/postgres-read-store.ts` |
| Modified | 98,545 | `25bd4971942c235a3bcf672dfbda1b96412b31c1b24fb8d6a990e89bb7f236fe` | `src/lib/learning-loop/postgres-store.ts` |
| Modified | 16,544 | `f0b4ad5788df72559e0072c90da6b90ab73dedf31f6cd231de3d9cb5d7aa2c51` | `tests/learning-loop-postgres-read-store.test.ts` |
| Modified | 42,485 | `9ada128ca9cd53dbf5098bfa931aa25d56415a0c06fc441ec5d9c41ff861d44c` | `tests/learning-loop-postgres-store.test.ts` |
| Modified | 20,514 | `a9a8ae4d804f4c5665a9f341418264a51c70000fb81e3662bd011f11cb3b6dbf` | `tests/p2-load-ramp.test.ts` |
| Modified | 35,458 | `a953228d32c1ca0209cf475364309ad2cb2778302416e82d96d0ad2da5483177` | `tests/p2-operations-gates.test.ts` |
| Untracked | 9,957 | `f0484484b295662d7030b3a5621406187b5c98d43c77813b3f4c238b6c981c7d` | `tests/p2-soak-admission-gate.test.ts` |

The authoritative nine-line, 932-byte source-file manifest has SHA-256
`c96e1530c7a8d5def4cf949f863b33260375449fcb7d66baaf9255b17fa57b64`.
All nine files are text, regular, and non-symlink. `git diff --check` passed
for the seven tracked files, and no whitespace-error output was produced for
the two untracked files under `git diff --no-index --check`.

The exact committed base is explicitly exported as final's head in
`/Volumes/Starship/UAIS-archives/2026-08-27/UAIS-S25-all-local-refs-20260827.bundle`,
whose complete-history verification and SHA-256 are recorded separately.
This establishes a future reconstruction prerequisite; no working-copy patch
or source archive was generated in this intake.

## Counts-only source literal review

The nine source/test files were scanned without emitting matching values.

| High-confidence shape | Count |
| --- | ---: |
| Private-key begin marker | 0 |
| Private-key end marker | 0 |
| AWS access-key shape | 0 |
| GitHub token shape | 0 |
| Bearer literal shape | 0 |
| Credentialed URL shape | 0 |
| Non-example environment filename in the nine-path manifest | 0 |

A deliberately broad credential-assignment candidate pattern found three
occurrences, all in `tests/p2-operations-gates.test.ts` at lines 715, 747, and
846. No matching text or literal was emitted. A second value-redacted
structural review found that all three are `password` fields, complete quoted
literals of length 35, contain an explicit test-placeholder marker, and do not
have a mixed-character high-entropy shape. They are classified
`STRUCTURALLY_SYNTHETIC_TEST_FIXTURE`, with zero unresolved candidates. This
classification supports a future source-only package review but does not by
itself grant package-copy authority.

## Evidence/log quarantine boundary

The 24 coordination paths consist of 18 reports and six session logs. Their
filenames identify staging database attestations, candidate/deployment
attestations, release/soak decisions, accessibility/RUM operator material,
dependency reachability, and session histories. These may contain deployment
identifiers, database or provider runtime metadata, URLs, operational samples,
or other evidence that the prior source-derived archive authorization excluded.

For this reason, the intake emitted only path, category, MIME type, size, and a
single opaque aggregate content binding. It did not emit any evidence value or
individual evidence-file content hash. Aggregate binding SHA-256:
`c295b13ac22d5c68752a8a99a7da47347684a18f1c6d070254b71cc3ebe310d0`.

The 24 files remain in place and are not authorized for archive copy, Trash,
deletion, staging, or commit by this intake.

## Current release and active-use gate

No final coordination file newer than 2026-08-27 01:40 HKT exists at this
checkpoint. Current authoritative status remains:

- `NO_GO`
- `SOAK_NOT_ADMITTED`
- `PRODUCTION_AUTHORIZATION=NO`

PIDs 60841, 60842, and 60848 remain alive with current directories under the
final worktree's `output/playwright/staging-a11y-anon` path. They were not
terminated.

## Exact next authorization boundary

A future source-only preservation action should, if approved, be limited to:

1. a binary-capable patch for the seven tracked source/test paths;
2. an allowlisted archive containing only the two untracked source/test paths;
3. the nine-path and source-file-hash manifests above;
4. exact-base binding to `376efeda...` and the already verified all-local-refs
   bundle;
5. the recorded value-redacted structural classification of the three
   synthetic test-fixture candidates; and
6. reconstruction in a task-scoped directory with 9/9 hash and byte equality,
   path-set equality, `git diff --check`, and `git fsck --full`.

That authority must explicitly exclude all 24 evidence/log paths unless the
owner separately classifies them. Even a successful source-only
reconstruction would not authorize final worktree removal while the evidence
paths, active processes, and release NO-GO remain.

No product test, lint, or build was run. This receipt proves only the current
path partition, source-file hashes, opaque evidence binding, and review gates;
it does not prove product correctness, CI, deployment, soak, accessibility,
or production readiness.
