# 2026-08-24 S22 — Current-candidate staging INP lane

## Assignment

- Session: `S22` with S01 client instrumentation and S11 independent review.
- Objective: implement a privacy-bounded, current-candidate INP p75 evidence lane
  that can run only on the isolated `uais-staging` project, without changing or
  deploying production.
- Owner authorization: exact-path local commit and isolated staging redeploy are
  authorized. Push to `main` and production deployment are not authorized.

## Implemented

- Added a five-scalar INP client beacon for six fixed student/teacher journeys.
  The hard-load journey and viewport are fixed for the document lifecycle.
  App Router navigation to another or unsupported journey permanently taints
  the lifecycle, including leave-and-return cases.
- Added a same-origin, signed-session, role-matched, approved-adult-operator
  collection route with a 512-byte capped stream reader. Raw account, URL, DOM
  target, and arbitrary metric fields are never persisted.
- Added in-memory and isolated PostgreSQL lifecycle stores with exact release
  binding, deduplication, cohort/hour caps, 48-hour expiry, explicit
  open/closed/purged lifecycle, aggregate/readiness, exact purge, and separate
  zero-residue readback.
- Added explicit schema setup with named constraints and canonical temporary-DDL
  catalog parity for columns, types, defaults, collation/storage, constraints,
  indexes, relation persistence/options, RLS, inheritance, rules, policies, and
  internal trigger state. Every persistent relation is `public.`-qualified,
  replication role must be `origin`, and a relation-name-only readback is not
  accepted.
- Added an hourly expiry endpoint whose guard is independent of collection,
  cohort, candidate, operator, and session settings. It still requires the
  isolated staging project/runtime, immutable staging host, staging database,
  strong cron secret, and the database's internal source guard.
- Kept the cron out of default `vercel.json`; it exists only in
  `vercel.staging.json`, which must be selected explicitly with Vercel's
  `--local-config` option for the isolated staging deployment lane.
- Added a deterministic allowlisted deployable-source SHA-256. `next.config.ts`
  recomputes it during an enabled staging build, fails a mismatch, and compiles
  the verified digest into the server artifact. Runtime collection refuses a
  self-asserted content digest.
- Required a one-use candidate-bound cohort form:
  `p2-inp-<full candidate Git SHA>-<unique suffix>`.
- Added a fail-closed lifecycle harness for schema setup, non-closing readiness,
  12-group threshold evaluation, finalize-and-purge, separate readback, and
  expiry cleanup. Reports explicitly keep `productionFieldInpProven: false`.

## Checks

- Focused INP plus env catalog: PASS, 9 files and 48 tests passed. The separate
  real-PostgreSQL integration file remains conditional: 2 tests skipped because
  the dedicated staging database URL is absent. A full focused rerun used a
  workspace-volume `TMPDIR` after the nearly-full macOS system volume prevented
  Vitest from creating its jsdom temp directory; that environment failure did
  not execute product assertions.
- Targeted ESLint across implementation, config, scripts, and tests: PASS.
- Targeted TypeScript config excluding generated unrelated Next route types:
  PASS, including both generated Next validators for the new route facades.
- Both new lifecycle/content `.mjs` files pass `node --check`; the no-env
  lifecycle smoke exits `2` with a redacted `BLOCKED_ENV` report as designed.
- Independent S11 static review found no remaining P0-P3 code finding and
  accepted this exact-path slice for the authorized local commit. That review
  explicitly did not elevate database, deployment, or field evidence to PASS.
- `next build --webpack`: application compilation PASS in 59 seconds, including
  staging content-digest verification. The subsequent repository-wide Next 16
  generated type phase FAILS on pre-existing route modules that export test
  factories, legacy dynamic-route context types, and two page prop contracts.
  Neither new observability route facade appears in those diagnostics.
- Full deterministic suite: shards 1, 2, 3, and separately-run shard 5 PASS.
  Across all five shards, 2,946 tests passed and 24 conditional tests skipped.
  Shard 4 had exactly two failures, both in the preserved, unrelated
  `tests/p2-operations-gates.test.ts` overlay: its canonical reports still bind
  historical SHA `7305d341...` while repository HEAD is `d5003ef7...`, including
  the partial Windows/NVDA record. Those reports were deliberately not rewritten
  into current evidence.
- Real PostgreSQL execution: NOT RUN/PASS. `UAIS_P2_STAGING_DATABASE_URL` is not
  present in the linked `uais-staging` project, so the two dedicated integration
  tests remain conditional skips.

## Current boundary and blockers

- No new immutable staging deployment exists for the eventual local commit.
- A redacted pull from the linked `uais-staging` project found the six
  owner-approved names absent: the three staging database URLs, protection
  bypass secret, staging marker, and chatroom-groups mode. Approval of variable
  names is not evidence that values have been supplied or placed.
- Generated INP run identifiers/secrets also need staging-only placement before
  collection can be enabled. No real value is recorded here.
- Deployment cannot be attempted truthfully until the actual staging value
  source is supplied and the repository-wide Next 16 generated-type build
  blockers are resolved or an already-approved release mechanism proves an
  equivalent clean build.
- No live provider/email/OSS/KB/export/voice action, real field cohort, assistive
  technology run, production journey, production write/readback, or production
  SHA binding was performed. Production remains untouched.

## Handoff

- Preserve unrelated report/test/session-log overlay paths; stage only the
  explicitly reviewed INP/config/docs/test/log pathspecs.
- After the exact commit, compute the digest from a clean checkout/export of the
  final SHA, use a unique SHA-bound cohort, and deploy only to `uais-staging`
  with `vercel.staging.json` after all redacted preflights pass.
- Never elevate the focused local results or historical P1/P2 JSON into
  current-SHA staging or production proof.
