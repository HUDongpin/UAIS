# UAIS P1 local validation evidence

Run ID: `p1-candidate-20260822-1444-HKT`
Branch: `codex/p1-learning-closed-loop`
Base SHA: `fd09ef322d14316cabaf8cc6d33f23dacc0b61b3`
Candidate code SHA: `19c6774241227a1688b0d229acc643bbb5c18514`
Classification: `implemented-unverified`

The seven code/tooling slices are committed on the isolated P1 branch. The
shared root is clean at local `main` SHA `0eb5f1d`; the P2 worktree remains an
active S22 staging surface and has not formally handed off. No integration,
merge, push, migration or deployment occurred in this evidence run.

## Passing local gates

| Gate | Result |
| --- | --- |
| P1 focused behavior | `npm run test:p1`: 24 files, 165/165 passed at candidate code SHA |
| Critical journeys | `npm run test:critical`: 7 files, 107/107 passed |
| Static quality | `npm run lint`: passed |
| Next route validation | focused contract covers all 17 P1-changed API route files and passed inside `test:p1` |
| Patch hygiene | tracked diff plus every untracked path passed; all 11 inventoried warnings removed |
| Missing load DB behavior | `npm run test:load:p1`: exit 2 with redacted `launch-critical-skipped` receipt |
| Missing integration DB behavior | `npm run test:db`: exit 2 with redacted `launch-critical-skipped`; only a dedicated guarded URL is accepted |

The 2026-08-21 uncommitted implementation also had a passing temporary P1-only
TypeScript lane and 15 generated route validators. Those historical runs are
not promoted to current-SHA proof. Current candidate proof is the 17-file
static Next 16 export/Promise contract plus the real webpack build boundary
recorded below.

## Focused evidence map

- Domain/state/version/content rules: `learning-loop-domain`, migrations and
  Postgres store suites.
- Course/lesson/task identity and publication: activity API, manifest and
  teacher activity UI suites.
- Student checkpoint/autosave/conflict/sealing: student API and Practice panel
  suites.
- Teacher authorization/queue/feedback/decision: teacher submission API and
  review UI suites.
- Complete V1 → revision → V2 → acceptance path: stateful critical journey.
- Trusted profile/recommendation/dashboard: Postgres read store and student
  dashboard UI suites.
- xAPI mirror: outbox worker/route, deterministic statement and retry suites.
- Next 16 route shape: all 17 P1-changed route files are enumerated in the
  export and Promise-only parameter contract suite.

## Gates that did not pass

### Repository full suite

- `npm run test` was not rerun at candidate code SHA `19c6774`.
- The prior uncommitted run's process chain later proved stale and blocked on an
  inherited Docker readiness probe; S25 terminated only that confirmed chain
  with `SIGTERM` and verified all five PIDs absent.
- Historical partial results cannot validate the current candidate, so the
  repository aggregate suite remains **not passed**.

### Production build

- At candidate code SHA `19c6774`, default `npm run build` stopped before source
  compilation because Turbopack rejected the worktree's external
  `node_modules` symlink.
- At the same SHA, `npm run build -- --webpack` compiled successfully in about
  2.5 minutes, then Next route type validation failed first on the unchanged
  `src/app/api/ai/chat/route.ts` unsupported export.
- All 17 P1-changed routes pass the focused contract, but the repository
  aggregate build is **not passed**. The inherited route debt must be retested
  after P1 is integrated onto the P2 tip.

### External evidence

No isolated database, staging Vercel project, staging LRS tenant, live provider,
browser E2E, load execution, pilot or production environment was used. No real
student text, feedback text, account password, token, cookie, DSN or API key was
logged or written.

## Exact next gates

1. Obtain formal S22 handoff and a clean P2 worktree, then integrate the eight
   P1 commits onto the P2 tip with a normal dependency installation.
2. Re-run the full suite and normal production build on that single integrated
   SHA; confirm whether P2 already closes the inherited Next 16 route debt.
3. Supply a dedicated guarded Postgres URL through
   `UAIS_DB_TEST_DATABASE_URL` and run `npm run test:db`.
4. Create a dedicated load database with the explicit
   `isolated-p1-load-test` guard and run `npm run test:load:p1`.
5. Run isolated staging browser, LRS outage/recovery, AI failure and chat
   coexistence tests.
6. Complete the 5–10, 20 and 200 learner stages and bind evidence to one
   candidate SHA/release-run ID.
7. Obtain independent review and explicit owner production authorization.

The DB-test and load-test guards are intentionally outside the application
migrations so a test cannot create its own authorization to write. An operator
must create the table and the appropriate row in each dedicated test database
before setting its dedicated URL:

```sql
CREATE TABLE uais_environment_guard (
  environment text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false
);

INSERT INTO uais_environment_guard (environment, enabled)
VALUES ('isolated-uais-db-test', true)
ON CONFLICT (environment) DO UPDATE SET enabled = EXCLUDED.enabled;
```

Run the integration DB lane with only its dedicated target variable set:

```text
UAIS_DB_TEST_DATABASE_URL=<isolated database URL> npm run test:db
```

For the separate load database, use the same table definition but insert
`isolated-p1-load-test`, then run:

```text
UAIS_P1_LOAD_TEST_DATABASE_URL=<isolated database URL> npm run test:load:p1
```

Both runners clear ordinary `DATABASE_URL` and `POSTGRES_URL` before migrations
and tests and never print the selected URL.
