# Phase 1 — Durable Postgres Cutover Readiness & Execution Runbook

- **Date:** 2026-07-18
- **Owning sessions:** S12 (adapters/contracts), S08 (types/invariants), S22 (migration reliability + parity), S19 (redacted env/credentials only)
- **Status:** **Blocked on owner input** — see §1. This runbook makes the cutover mechanical once the blockers clear.
- **Companion:** `20260718_UAIS_Next Development Plan.md` (Phase 1), `docs/architecture-map.md` (§Migration Rule), `docs/core-schema-design.md`.

## 0. Verified current state (2026-07-18)

Grounded in a read of the tree, not the schema doc:

- **Schema exists, live data does not use it.** `src/lib/db/schema.ts` defines 14 Drizzle tables; `migrations/0001_core_poc.sql` is the only migration.
- **Managed persistence is partial.** Official LangGraph `PostgresSaver`/`PostgresStore` run in the isolated `uais_langgraph` schema (deployed). `teaching-course-management-postgres-store.ts` is a **transitional** Postgres seam behind the repository interface, selected by `UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=postgres`, and returns **503 if `UAIS_CORE_DATABASE_URL` is not ready**.
- **The core operations store is file-based.** `src/lib/server/teaching-operations-store.ts` (4,926 lines) persists to `teaching-operations.json` via `readFile`/`writeFile`/`rename`/`rm` — **no Postgres seam**. This is the primary durability gap on serverless hosting.
- **Migration runner needs a real URL.** `scripts/apply-core-migrations.mjs` reads `UAIS_CORE_DATABASE_URL` / `DATABASE_URL` / `POSTGRES_URL`, then applies `0001_core_poc` + the LangGraph checkpointer/store inside a transaction with a `uais_schema_migrations` ledger (checksum-guarded, idempotent). It exits(1) with a redacted message if no URL is set.

## 1. Blockers (owner input required)

These are Owner Decisions #2 and #3 from the next development plan. Nothing below can proceed without them, and none can be resolved by an AI session because they involve credentials and infrastructure choice.

1. **Migration path.** The 2026-07-10 S22 handoff recorded that direct and pooled Neon migrations **time out from the local environment**, while the same idempotent migration **succeeds from the Vercel build network**. Local tooling here confirms the constraint: docker daemon down, no local Postgres binaries, no in-memory PG driver, and no `UAIS_CORE_DATABASE_URL` configured. Choose one:
   - **(a) Vercel-build-only migrations** (already wired via `npm run vercel-build`); treat local as read-only against a branch DB.
   - **(b) A locally reachable Neon branch/pooler** with a working connection string for developer-run migrations + parity tests.
   - **(c) An owner-run one-shot migration job.**
   - Do **not** add a public migration endpoint.
2. **Credential placement.** A server-only `UAIS_CORE_DATABASE_URL` (and any branch URL) must be placed by S19 with owner approval. AI sessions must not read, print, or store the value.
3. **Cutover go-ahead per entity.** Confirm the order below and authorize switching reads to Postgres one entity at a time.

## 2. Recommended entity order

Lowest-risk first, following `schema.ts`. Note: there is **no `users` store to cut over** today — auth is `local-demo` accounts + an optional trusted provider, so user persistence is a *new* build, not a migration. Start with the entities that already have a durable-but-non-managed store:

1. **`teaching_course_management` snapshot** (courses/lessons/classes) — a transitional seam already exists; finish parity + read cutover first.
2. **`teaching_operations`** (records/audit) — currently `teaching-operations.json`; **build the Postgres seam** (largest gap).
3. **`enrollments` / `classes` / `invite_codes`** — enrolment journey durability.
4. **`assessments` / `submissions`** — gradebook durability.
5. **`learning_events` / `learner_profiles` / `recommendations`** — last; analytics tolerate eventual consistency.

## 3. Per-entity execution loop (expand → migrate → contract)

Repeat for each entity; do not batch entities.

1. **Confirm shape.** Diff the store's in-memory/JSON record shape against the Drizzle table. Add any missing column via a **new** numbered migration (`0002_*.sql`, …); never edit `0001`.
2. **Adapter behind the seam.** Implement a Postgres repository mirroring `teaching-course-management-postgres-store.ts` (readiness gate → 503 without `UAIS_CORE_DATABASE_URL`; policy descriptors; transactional replace). Keep the existing interface unchanged.
3. **Dual-write + backfill.** Write JSON *and* Postgres; backfill existing JSON rows in one window; add parity assertions (row counts, checksums).
4. **Prove parity in staging** (Phase 4 lane) for the same release slice.
5. **Switch reads** behind an env flag (`UAIS_*_BACKEND=postgres`); keep JSON as a fallback path.
6. **Contract.** Remove the JSON path only after a demonstrated rollback (flip the flag → reads return to JSON with no data loss).

## 4. Acceptance per entity

- Create/read/update survives a server restart and is consistent across instances.
- Parity tests pass in staging for the release slice.
- A documented, exercised rollback flips reads back to JSON without loss.

## 5. Checks

`npm run test` (+ targeted store/API tests), `npm run lint`, `npm run build`, `npm run db:migrate` against the branch DB, and a staging smoke. Contract policy/SQL-building can be unit-tested without a live DB (see `tests/teaching-course-management-postgres-policy.test.ts`, `tests/core-database-foundation.test.ts`); round-trip parity requires a reachable Postgres.

## 6. Risks

- **Local migration timeout** → resolved by the §1.1 path decision.
- **Dual-write divergence** → parity tests + single backfill window + env-flagged read switch with JSON fallback.
- **Serverless connection limits** → use the Neon pooler; the runner already sets `max: 1, prepare: false`.
- **Editing the 4,926-line operations store** → add characterization tests first (shared with Phase 3), extract the persistence layer behind a seam before swapping the backend.

## 7. What was done in this pass (2026-07-18)

Executed against a **local ephemeral Postgres 16 container** (throwaway, no real data or
credentials) to actually exercise the cutover path, not just describe it:

- **Ran the real migration locally.** `npm run db:migrate` applied `0001_core_poc` plus the
  official LangGraph `PostgresSaver`/`PostgresStore` into `uais_langgraph`. Verified 16 core
  tables + 6 LangGraph tables were created. The "migration times out" note from 2026-07-10 is
  a **Neon-network-specific** condition, not a code problem — the migration path itself works.
- **Found and fixed a real adapter bug (committed).** Exercising the `teaching-course-management`
  Postgres adapter against the live DB surfaced that its `write()` threw against *any* real
  Postgres: `sql.json(db)` produced a jsonb parameter that postgres v3.4.9 leaves unserialized
  at Bind inside `sql.begin()`. Fixed with `JSON.stringify(...)::text::jsonb`. The transitional
  adapter had clearly never been round-tripped against a database.
- **Verified a genuine round-trip + optimistic concurrency.** Added a DB-backed integration
  test (`tests/teaching-course-management-postgres-integration.test.ts`, skips without
  `UAIS_CORE_DATABASE_URL`): snapshot write→read parity and stale-revision (409) rejection both
  pass against the local Postgres. This proves the *expand* adapter for course-management is now
  functional and durable.
- **Implemented + verified the full expand→migrate→contract cycle for `teaching_course_management`
  (commit).** New `teaching-course-management-cutover.ts`:
  `backfillTeachingCourseManagementToPostgres()` (copy JSON-file snapshot → Postgres, verify
  parity) and `verifyTeachingCourseManagementParity()` (read-only dual-source gate, results
  redacted to counts). Reads switch via `UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=postgres` (the
  store resolver already returns the Postgres repo) and roll back by unsetting the flag (the JSON
  file is never mutated). A DB-backed integration test drives the whole cycle — seed JSON →
  backfill+parity → read-only gate → Postgres read-switch → JSON rollback → drift detection — and
  passes against local Postgres 16.
- **Still blocked (needs §1 owner input):** running this cycle against the **live Neon** DB
  (place `UAIS_CORE_DATABASE_URL` via S19, `npm run db:migrate`, run the backfill, confirm
  parity, set the backend flag), staging parity sign-off, and building the equivalent adapter for
  the file-based `teaching_operations` store. Local verification does not substitute for staged
  production parity; these need the owner's migration-path decision + credentials + go-ahead.

### Live cutover procedure for `teaching_course_management` (once §1 clears)

```
# 1. Place UAIS_CORE_DATABASE_URL (S19, server-only) and migrate:
npm run db:migrate
# 2. Backfill + verify parity (returns status:"parity" and entity counts):
#    call backfillTeachingCourseManagementToPostgres({ env, sourceDataDir })
# 3. Re-check parity as a gate: verifyTeachingCourseManagementParity(...) -> "parity"
# 4. Switch reads: set UAIS_TEACHING_COURSE_MANAGEMENT_BACKEND=postgres
# 5. Rollback if needed: unset the flag (reads return to the untouched JSON file)
```

### Reproduce the local verification

```
docker run -d --name uais-local-pg -e POSTGRES_PASSWORD=<local> -e POSTGRES_DB=uais_core \
  -p 55432:5432 postgres:16
UAIS_CORE_DATABASE_URL="postgresql://postgres:<local>@127.0.0.1:55432/uais_core" npm run db:migrate
UAIS_CORE_DATABASE_URL="postgresql://postgres:<local>@127.0.0.1:55432/uais_core" \
  npx vitest run tests/teaching-course-management-postgres-integration.test.ts
```
