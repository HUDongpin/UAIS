# UAIS P1 acceptance ledger

Candidate branch: `codex/p1-learning-closed-loop`
Base SHA: `fd09ef322d14316cabaf8cc6d33f23dacc0b61b3`
Candidate code SHA: `19c6774241227a1688b0d229acc643bbb5c18514`
Release state: `implemented-unverified`
Production authorization: **not granted**

Status vocabulary:

- `not-started`: no implementation evidence yet.
- `red-proven`: a focused test demonstrated the missing behavior.
- `implemented-unverified`: code exists but an independent current-SHA gate is missing.
- `verified-local`: focused and required local gates passed.
- `verified-db-lane`: isolated Postgres migration/transaction gates passed.
- `verified-staging`: isolated Vercel + DB + LRS browser/load/failure gates passed.
- `ready-for-production`: all review and owner release prerequisites are satisfied.
- `verified-production`: main SHA, Vercel READY, migration health, browser journey and monitoring are all separately proven.

No P1 item advances beyond `implemented-unverified`: seven code/tooling commits
now provide an exact candidate code SHA, but isolated Postgres/staging evidence,
the load result, aggregate build/full-suite proof, independent review and the
real pilot are still missing. Focused local evidence establishes implementation
depth but does not substitute for those release gates.

| ID | Acceptance item | Current status | Local implementation evidence | Missing independent evidence |
| --- | --- | --- | --- | --- |
| P1-AC-01 | A real published lesson unit can be bound to and publish a real activity | implemented-unverified | manifest identity, teacher activity API/UI and critical journey tests | isolated DB rows + browser journey |
| P1-AC-02 | Activity is bilingual, rubric-valid and invisible before publication | implemented-unverified | domain validation and authorized API tests | current candidate staging proof |
| P1-AC-03 | A formative checkpoint attempt is transactionally persisted | implemented-unverified | transaction store/API tests and persisted receipt contract | real Postgres lane |
| P1-AC-04 | Draft survives refresh, sign-out and a second device without crossing accounts | implemented-unverified | autosave/readback UI tests; recovery is scoped to account + course + class + activity, rejects legacy/mismatched data and expires after seven days | shared-browser account-switch + cross-device browser + real DB |
| P1-AC-05 | Submitted versions are sealed and immutable | implemented-unverified | state-machine, migration constraint and API tests | real Postgres constraint proof |
| P1-AC-06 | Concurrent devices receive recoverable 409 without silent text loss | implemented-unverified | store concurrency and merge-preserving UI tests | two-browser staging proof |
| P1-AC-07 | Teacher review queue contains only authorized real submissions | implemented-unverified | ownership API, DB aggregation and queue UI tests | real cohort conservation query |
| P1-AC-08 | AI draft is bound to one sealed version and invisible to students | implemented-unverified | strict schema/version/policy tests and critical journey | approved-provider staging proof + independent safety review |
| P1-AC-09 | Feedback release and teacher decision commit atomically | implemented-unverified | rollback/store/API tests | real Postgres injected-failure proof |
| P1-AC-10 | Revision creates V2 while preserving V1 and released feedback | implemented-unverified | critical journey and repository lifecycle tests | real Postgres/browser evidence |
| P1-AC-11 | Unit completes only when the teacher accepts the current version | implemented-unverified | projection/recommendation/dashboard tests | cross-device staging readback |
| P1-AC-12 | Signed-in dashboards contain no fabricated counts or students | implemented-unverified | honest empty-state and real aggregation UI/API tests | staging data review |
| P1-AC-13 | Postgres is authoritative and LRS failure does not block teaching | implemented-unverified | transaction/outbox/lease/replay/backlog tests | live isolated LRS outage/recovery |
| P1-AC-14 | 200-learner load conserves counts with no loss or duplicate sealing | implemented-unverified | guarded five-minute/200-student load harness implemented | dedicated guarded DB run + chat coexistence run |
| P1-AC-15 | Isolated staging and the real pilot complete the full journey | not-started | local stateful API critical journey only | isolated staging, 5–10/20/200 pilot, candidate SHA |

## Locked ownership and dependencies

| Package | Primary owner in this implementation worktree | Dependencies | Rollback boundary |
| --- | --- | --- | --- |
| P1-00 intake/ledger | S12 acting on owner-expanded plan; S25/S10 review later | clean shared root | remove worktree/branch only after reviewed handoff; no main impact |
| P1-10 domain/migrations | S12, with S08/S11/S16 review gates | existing 0001–0007 | additive migrations remain; old application ignores new columns/tables |
| P1-20 events/profile/outbox | S12, with S15/S19/S22 review gates | P1-10 | pause worker; pending outbox remains |
| P1-30 teacher activity | S12 vertical implementation, S05/S13/S09 review | frozen activity contract | archive target activity; preserve data |
| P1-40 learner evidence | S12 vertical implementation, S03/S09/S11 review | published activity and API | hide/disable activity; preserve drafts/versions |
| P1-50 feedback/revision | S12 vertical implementation, S05/S07/S13 review | sealed submission version | disable AI draft; manual feedback remains |
| P1-60 dashboards/recommendation | S12 vertical implementation, S03/S05/S08/S15 review | stable states/projections | return honest empty/collect-more-evidence state |
| P1-70 release proof | S11/S22/S25/S10 review required | all prior packages | no production action without owner authorization |

## Pilot fixture and production gate

- Implementation course: `elementary-math-research`.
- Implementation class: `elementary-math-research-class-1`.
- Existing lesson fallback key: `audio-manifest-elementary-math-research-natural-number-ordinal-theory-ppt1`.
- Production pilot account IDs are intentionally not invented. The staging/release packet must list one authorized teacher and 5–10 approved student account IDs, without passwords, before P1-AC-15 can advance beyond `implemented-unverified`.
- Formal grades and attendance remain in the institution's existing system.

## Evidence runs

| Run | SHA | Result |
| --- | --- | --- |
| baseline-20260821-0120-HKT | `fd09ef3` | clean root; 106/106 critical tests; lint and TypeScript passed |
| p1-local-20260821-0347-HKT | uncommitted worktree on `fd09ef3` | P1 24 files / 159 tests passed; critical 7 files / 107 tests passed; ESLint passed; P1-scoped TypeScript and all 15 generated Next route validators passed; diff check passed |
| p1-candidate-20260822-1444-HKT | `19c6774241227a1688b0d229acc643bbb5c18514` | P1 24 files / 165 tests passed; critical 7 files / 107 tests passed; ESLint passed; all 17 P1-changed route files passed the focused Next 16 contract; tracked and untracked patch hygiene passed |
| p1-db-20260821 | none | blocked with exit 2: dedicated guarded DB-test URL required; ordinary production DB variables are rejected; not counted as pass |
| p1-load-20260821 | none | blocked with exit 2: dedicated guarded load database required; not counted as pass |
| p1-full-suite-20260821 | uncommitted worktree | not passed: sandbox run 2675 passed / 109 failed due loopback `EPERM`; authorized parallel run did not converge; authorized serial run stopped on existing Docker readiness probe after 12 minutes |
| p1-build-20260821 | uncommitted worktree | not passed: default Turbopack rejected the worktree dependency symlink; webpack compiled, then Next route validation exposed inherited Next 16 route/page debt outside P1 |

## P1-70 hard gates still open

- Seven exact code/tooling slices are committed through candidate code SHA
  `19c6774`; the eighth documentation slice records this boundary. These commits
  remain local and have not been merged or pushed.
- The shared root is clean at local `main` SHA `0eb5f1d`, but the P2 worktree is
  actively owned by S22 and remains dirty. Integration must wait for its formal
  handoff and clean-status evidence.
- `npm run test:db` is intentionally red until an isolated Postgres URL is
  supplied through `UAIS_DB_TEST_DATABASE_URL` and the isolated DB guard exists;
  ordinary `DATABASE_URL`/`POSTGRES_URL` values are deliberately ignored.
- `npm run test:load:p1` is intentionally red until a dedicated database has an
  enabled `uais_environment_guard.environment = 'isolated-p1-load-test'` row.
- The candidate's webpack build compiled, then the repository-wide Next 16 type
  gate failed first on the inherited `src/app/api/ai/chat/route.ts` factory
  export. All 17 P1-changed routes pass the focused export/Promise-only
  contract, but that does not make the aggregate build green.
- No isolated Vercel staging, isolated LRS, browser journey, 5–10 learner pilot,
  20 learner rehearsal, 200 learner run, independent S11/S16 review, or owner
  production authorization has occurred.
- Production remains untouched: no migration, secret placement, push, merge,
  Vercel deployment, alias change, or LRS write was performed.
