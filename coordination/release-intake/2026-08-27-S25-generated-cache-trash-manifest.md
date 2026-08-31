# S25 recoverable generated-cache cleanup manifest

- Date: 2026-08-27 11:56 HKT
- Session: `S25`
- Recovery directory:
  `/Volumes/Starship/.Trashes/501/UAIS-S25-generated-dependencies-20260827-115601`
- Method: exact-path, same-volume `mv`; no wildcard deletion, `git clean`, or
  recursive repository removal.

## Authorized generated targets

| Source | Approx. KiB | Recovery name |
| --- | ---: | --- |
| `.scratch/hashdiag-5c48fbd.VAgUPK/node_modules` | 1,098,304 | `01-hashdiag-root-node_modules` |
| `.scratch/hashdiag-5c48fbd.VAgUPK/build-utils-run/node_modules` | 1,098,292 | `02-hashdiag-build-utils-node_modules` |
| `.scratch/hashdiag-5c48fbd.VAgUPK/npm-linux-no-vercel/node_modules` | 942,304 | `03-hashdiag-linux-no-vercel-node_modules` |
| `.scratch/hashdiag-5c48fbd.VAgUPK/npm-linux-sim/node_modules` | 1,104,236 | `04-hashdiag-linux-sim-node_modules` |
| `.scratch/hashdiag-5c48fbd.VAgUPK/vc59-runtime/node_modules` | 253,700 | `05-hashdiag-vc59-node_modules` |
| `.scratch/hashdiag-linux-5c48fbd.U2OlKC/node_modules` | 1,104,236 | `06-hashdiag-linux-root-node_modules` |
| `.scratch/p2-deploy.FvSXQa/node_modules` | 1,098,304 | `07-p2-deploy-node_modules` |
| `.scratch/p2-vercel59-repro.BLnj1Y/node_modules` | 1,098,292 | `08-p2-vercel59-node_modules` |
| `.scratch/reflow-fix.FwyMB8/node_modules` | 1,108,432 | `09-reflow-node_modules` |
| `.scratch/node-compile-cache` | 15,428 | `10-root-node-compile-cache` |
| `.scratch/vercel-59.3.0` | 15,424 | `11-downloaded-vercel-59.3.0` |
| `.scratch-p2-final.47XEGi/node-compile-cache` | 2,516 | `12-p2-final-node-compile-cache` |

These targets are dependencies, compile caches, or downloaded public package
artifacts. Their surrounding source, reports, evidence, manifests, database
dumps, `.next`, `.vercel`, environment/test-fixture files, and local provider
metadata remain in place.

## Explicit exclusions

- `.scratch/neon-http.ORPrEA`: contains unique operational evidence and
  database dump artifacts; retain.
- `.scratch/reflow-fix.FwyMB8` other than its `node_modules`: contains source,
  output, and evidence; retain.
- `.scratch-p2-final.47XEGi` other than its node compile cache: contains test
  fixtures and environment-shaped files; retain without reading values.
- Every registered Git worktree and both standalone dirty repositories: retain
  under their separate release and reconstruction gates.

Emptying the external volume's Trash is a separate irreversible action and is
not authorized by this move.

## Post-move verification

- Result: PASS.
- All 12 source paths are absent.
- All 12 recovery targets exist under the exact dated Trash directory.
- Recovery-directory logical size: 8,939,468 KiB.
- Remaining repository-local `.scratch`: 1,429,712 KiB.
- Remaining repository-local `.scratch-p2-final.47XEGi`: 15,492 KiB.
- Starship Trash was not emptied; the move is recoverable and therefore does
  not claim irreversible physical-space reclamation.
