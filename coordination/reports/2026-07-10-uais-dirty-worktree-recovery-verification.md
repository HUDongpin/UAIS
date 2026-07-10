# UAIS Dirty Worktree Recovery Verification

- Date: 2026-07-10 Asia/Hong_Kong
- Session: S25 Git hygiene and release intake
- Status: Compose recovery verified; local `main` update and source-root cleanup require separate owner approval
- Compose worktree: `/Users/dongpinhu/Desktop/UAIS-worktrees/recovery-compose-2026-07-10`
- Compose branch: `codex/uais-recovery-compose-2026-07-10`
- Compose commit before this evidence commit: `42a6db8244e0770e168c7819183a0ecedb06e7c5`

## Frozen source

- Source root: `/Users/dongpinhu/Desktop/UAIS`
- Source branch: `codex/uais-dirty-rescue-2026-06-30`
- Source base: `d28d8a6cb2e8efbdf29bf7515de2ae7e93d500a8`
- NUL-delimited status fingerprint: `cf919fa0876f7dcdb6e18874b1bc6c09c3fa94c2c4f5af8df91e4da716e38fc2`
- Current status: 116 paths; 44 tracked modifications, 72 untracked paths, zero staged paths
- Disposition: 115 commit candidates and one Q0 local-generated path
- External candidate backup: `/Users/dongpinhu/Desktop/UAIS-dirty-worktree-backups/2026-07-10-recovery-source`

The final source guard rechecked the status fingerprint and all 115 candidate hashes. The source root remains unchanged by the recovery execution.

## Recovery commits

| Package | Commit | Paths | Result |
| --- | --- | ---: | --- |
| R1 platform and release foundation | `2ef59d7` | 26 | focused tests, lint, and diff checks passed |
| R2 auth, backend, and managed data | `bdf3ec9` | 29 | focused tests, lint, and diff checks passed |
| R3 product routes and pages | `5603520` | 17 | focused test, lint, and diff checks passed |
| R4 AI, adaptive learning, and playback | `c156dd4` | 18 | focused tests, lint, and diff checks passed |
| R5 regression and documentation | `b83bda1` | 25 | focused tests passed; Q0 absent |

Recovery-control commits:

- `b5d8e03` — recovery composition CLI, tests, package manifest, and owner-pathspec coverage
- `d323a32` — frozen-source dirty map and source manifest
- `42a6db8` — isolate the Node-native recovery tests from Vitest collection

## Parity

- Commit candidates: 115
- Matched hashes: 115
- Mismatches: 0
- Q0 paths: 1
- Q0 absent from compose: true
- Q0 absent from the external content backup: true

`docs/technical-advisory/.Rhistory` was not inspected, hashed, copied, staged, or committed. It is represented only by path and disposition metadata.

## Verification results

- Recovery CLI Node-native suite: 5/5 tests passed.
- Full ESLint: passed.
- Full Vitest: 159/159 files and 1,982/1,982 tests passed.
- Next.js production build: passed; 23/23 static-generation units completed.
- Source lock check: passed; 115 candidate hashes and status fingerprint unchanged.
- Source-to-compose parity: passed; 115/115.

The first full Vitest attempt correctly exposed that the Node-native recovery test used a `*.test.mjs` name covered by Vitest's default glob. The test was renamed to `*.node-test.mjs`; explicit `node --test` and full Vitest both passed afterward.

## Intentional Markdown whitespace exception

`docs/technical-advisory/20260708-UAIS-Codex-Verification-Report.md` contains two source-authored Markdown hard-breaks at lines 3 and 4. A normal staged `git diff --check` reported their two trailing spaces. The owner explicitly approved preserving the frozen source bytes, the compose SHA-256 remained equal to the manifest, and a one-shot check with `core.whitespace=-blank-at-eol` passed. No repository or global Git configuration was changed. After the byte-identical file was committed, the working-tree `git diff --check` passed.

## Deferred approval boundary

The following actions were not performed and remain separately approval-gated:

1. Fast-forward or otherwise update local `main`.
2. Restore the 44 tracked source paths.
3. Remove the 71 untracked commit-candidate source paths.
4. Decide and apply the Q0 disposition.
5. Remove the compose worktree.
6. Prune the two stale proof-worktree records.
7. Return the original root checkout to clean `main`.

No Git remote is configured, so remote review, push, pull request, and CI/CD evidence remain outside this local recovery phase.
